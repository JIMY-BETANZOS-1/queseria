package pe.queseria.campo.ui.inicio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import pe.queseria.campo.datos.local.EstadoSync
import pe.queseria.campo.datos.local.ProductorFila

/** Textos de cada fila de "Mis productores" (B3). */
class ResumenProductorTest {

    private fun fila(
        nombre: String = "Juana Mamani",
        codigo: String? = "P-0007",
        aprobado: Boolean = true,
        estadoSync: String = EstadoSync.SINCRONIZADO,
        sancionado: Boolean = false,
        bloqueado: Boolean = false,
        sancionHasta: String? = null,
        nHoy: Int = 0,
        litrosHoy: Double = 0.0,
    ) = ProductorFila(
        clave = "id:7", servidorId = 7, uuidCliente = null, codigo = codigo, nombre = nombre,
        rutaId = 3, rutaNombre = "Huata Norte", aprobado = aprobado, estadoSync = estadoSync,
        sancionado = sancionado, bloqueado = bloqueado, sancionHasta = sancionHasta,
        nHoy = nHoy, litrosHoy = litrosHoy,
    )

    @Test
    fun `avisa bloqueo y sancion con la fecha de fin`() {
        assertEquals("BLOQUEADO hasta 21/10",
            ResumenProductor.aviso(fila(bloqueado = true, sancionado = true, sancionHasta = "2026-10-21")))
        assertEquals("SANCIONADO hasta 21/10",
            ResumenProductor.aviso(fila(sancionado = true, sancionHasta = "2026-10-21")))
        assertEquals("SANCIONADO", ResumenProductor.aviso(fila(sancionado = true)))
    }

    @Test
    fun `el productor normal no lleva aviso ni rojo`() {
        assertNull(ResumenProductor.aviso(fila()))
        assertFalse(ResumenProductor.enRojo(fila()))
        assertTrue(ResumenProductor.enRojo(fila(sancionado = true)))
        assertTrue(ResumenProductor.enRojo(fila(bloqueado = true)))
    }

    @Test
    fun `estado del dia pendiente o con el total y las entregas del dia`() {
        assertEquals("Pendiente", ResumenProductor.estadoDelDia(fila()))
        assertEquals("✓ 23.50 L hoy · 2 entregas",
            ResumenProductor.estadoDelDia(fila(nHoy = 2, litrosHoy = 23.5)))
        assertEquals("✓ 8.00 L hoy · 1 entrega",
            ResumenProductor.estadoDelDia(fila(nHoy = 1, litrosHoy = 8.0)))
        assertEquals("✓ 40.00 L hoy · 3 entregas",
            ResumenProductor.estadoDelDia(fila(nHoy = 3, litrosHoy = 40.0)))
    }

    @Test
    fun `varias entregas por dia estan permitidas y se confirman antes de abrir B4`() {
        val primera = fila()
        assertFalse("la primera entrega del día se abre de una", ResumenProductor.pideConfirmarOtraEntrega(primera))
        assertNull(ResumenProductor.yaEntregoHoy(primera))

        val yaEntrego = fila(nHoy = 2, litrosHoy = 23.5)
        assertTrue(ResumenProductor.pideConfirmarOtraEntrega(yaEntrego))
        assertEquals(
            "Juana Mamani ya tiene 2 entregas hoy por 23.50 L. ¿Registrar otra entrega?",
            ResumenProductor.textoOtraEntrega(yaEntrego),
        )
        assertEquals(
            "Ya registró 23.50 L hoy en 2 entregas. Esta es otra entrega.",
            ResumenProductor.yaEntregoHoy(yaEntrego),
        )
        assertEquals(
            "Juana Mamani ya tiene 1 entrega hoy por 8.00 L. ¿Registrar otra entrega?",
            ResumenProductor.textoOtraEntrega(fila(nHoy = 1, litrosHoy = 8.0)),
        )
    }

    @Test
    fun `singular y plural de las entregas`() {
        assertEquals("1 entrega", ResumenProductor.entregas(1))
        assertEquals("2 entregas", ResumenProductor.entregas(2))
        assertEquals("12 entregas", ResumenProductor.entregas(12))
    }

    @Test
    fun `marca las altas de campo no aprobadas y sin enviar`() {
        val alta = fila(aprobado = false, estadoSync = EstadoSync.PENDIENTE)
        assertTrue(ResumenProductor.noAprobado(alta))
        assertTrue(ResumenProductor.sinEnviar(alta))
        assertFalse(ResumenProductor.noAprobado(fila()))
        assertFalse(ResumenProductor.sinEnviar(fila()))
    }

    @Test
    fun `el buscador acepta nombre o codigo sin distinguir mayusculas`() {
        assertTrue(ResumenProductor.coincide(fila(), ""))
        assertTrue(ResumenProductor.coincide(fila(), "  "))
        assertTrue(ResumenProductor.coincide(fila(), "mamani"))
        assertTrue(ResumenProductor.coincide(fila(), "p-0007"))
        assertFalse(ResumenProductor.coincide(fila(), "Quispe"))
        assertFalse(ResumenProductor.coincide(fila(codigo = null), "P-0007"))
    }

    @Test
    fun `fecha corta tolera nulos y basura`() {
        assertNull(ResumenProductor.fechaCorta(null))
        assertNull(ResumenProductor.fechaCorta(""))
        assertNull(ResumenProductor.fechaCorta("no es fecha"))
        assertEquals("21/10", ResumenProductor.fechaCorta("2026-10-21"))
        assertEquals("21/10", ResumenProductor.fechaCorta("2026-10-21T00:00:00Z"))
    }
}
