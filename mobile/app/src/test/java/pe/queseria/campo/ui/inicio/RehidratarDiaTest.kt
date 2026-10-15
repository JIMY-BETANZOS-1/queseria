package pe.queseria.campo.ui.inicio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test
import pe.queseria.campo.datos.local.EstadoSync
import pe.queseria.campo.datos.local.ProductorFila

/**
 * B3 en un celular reinstalado: lo que el servidor ya tiene de hoy se suma a lo local sin contar
 * dos veces las recolecciones que están en los dos lados.
 */
class RehidratarDiaTest {

    private fun fila(
        clave: String = "id:7",
        servidorId: Long? = 7,
        nombre: String = "Juana Mamani",
        nHoy: Int = 0,
        litrosHoy: Double = 0.0,
    ) = ProductorFila(
        clave = clave, servidorId = servidorId, uuidCliente = null, codigo = "P-0007", nombre = nombre,
        rutaId = 3, rutaNombre = "Huata Norte", aprobado = true, estadoSync = EstadoSync.SINCRONIZADO,
        sancionado = false, bloqueado = false, sancionHasta = null, nHoy = nHoy, litrosHoy = litrosHoy,
    )

    private fun entrega(id: String, productorId: Long = 7, litros: Double = 12.3, anulada: Boolean = false) =
        EntregaServidor(id, productorId, litros, anulada)

    @Test
    fun `en un celular limpio el total del dia sale del servidor`() {
        val fusionadas = RehidratarDia.fusionar(
            filas = listOf(fila(), fila(clave = "id:8", servidorId = 8, nombre = "Pedro Quispe")),
            delServidor = listOf(entrega("a", litros = 12.3), entrega("b", litros = 11.2)),
            idsLocales = emptySet(),
        )
        val juana = fusionadas.single { it.servidorId == 7L }
        assertEquals(2, juana.nHoy)
        assertEquals(23.5, juana.litrosHoy, 0.001)
        assertEquals("✓ 23.50 L hoy · 2 entregas", ResumenProductor.estadoDelDia(juana))

        val pedro = fusionadas.single { it.servidorId == 8L }
        assertEquals("sin entregas en el servidor sigue pendiente", 0, pedro.nHoy)
        assertEquals("Pendiente", ResumenProductor.estadoDelDia(pedro))
    }

    @Test
    fun `lo que ya esta en el celular no se cuenta dos veces`() {
        // "a" se registró en este celular y ya se sincronizó: Room la cuenta y el servidor la repite
        val fusionadas = RehidratarDia.fusionar(
            filas = listOf(fila(nHoy = 1, litrosHoy = 12.3)),
            delServidor = listOf(entrega("a", litros = 12.3), entrega("b", litros = 11.2)),
            idsLocales = setOf("a"),
        )
        assertEquals(2, fusionadas.single().nHoy)
        assertEquals(23.5, fusionadas.single().litrosHoy, 0.001)
    }

    @Test
    fun `el id se compara sin distinguir mayusculas`() {
        val fusionadas = RehidratarDia.fusionar(
            filas = listOf(fila(nHoy = 1, litrosHoy = 12.3)),
            delServidor = listOf(entrega("9F3A-B1", litros = 12.3)),
            idsLocales = setOf("9f3a-b1"),
        )
        assertEquals(1, fusionadas.single().nHoy)
        assertEquals(12.3, fusionadas.single().litrosHoy, 0.001)
    }

    @Test
    fun `las anuladas del servidor no suman`() {
        val fusionadas = RehidratarDia.fusionar(
            filas = listOf(fila()),
            delServidor = listOf(entrega("a", litros = 12.3, anulada = true)),
            idsLocales = emptySet(),
        )
        assertEquals(0, fusionadas.single().nHoy)
        assertEquals("Pendiente", ResumenProductor.estadoDelDia(fusionadas.single()))
    }

    @Test
    fun `sin datos del servidor las filas quedan intactas`() {
        val filas = listOf(fila(nHoy = 1, litrosHoy = 8.0))
        assertSame("sin red no se toca nada", filas, RehidratarDia.fusionar(filas, emptyList(), emptySet()))
        assertSame(filas, RehidratarDia.fusionar(filas, listOf(entrega("a")), setOf("a")))
    }

    @Test
    fun `un alta de campo sin id del servidor no se rehidrata`() {
        // mi-día devuelve productor_id; un productor que este celular aún no tiene emparejado se queda igual
        val alta = fila(clave = "uuid-nuevo", servidorId = null, nombre = "Alta de campo")
        val fusionadas = RehidratarDia.fusionar(listOf(alta), listOf(entrega("a", productorId = 99)), emptySet())
        assertEquals(0, fusionadas.single().nHoy)
    }
}
