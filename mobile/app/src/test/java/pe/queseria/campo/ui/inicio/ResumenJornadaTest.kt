package pe.queseria.campo.ui.inicio

import org.junit.Assert.assertEquals
import org.junit.Test
import pe.queseria.campo.datos.local.EstadoSync
import pe.queseria.campo.datos.local.ProductorFila
import pe.queseria.campo.ui.sync.TextosSync

/** Tarjeta de la jornada de B3: litros, entregas, productores atendidos y estado de envío. */
class ResumenJornadaTest {

    private fun fila(clave: String, nHoy: Int = 0, litrosHoy: Double = 0.0) = ProductorFila(
        clave = clave, servidorId = null, uuidCliente = null, codigo = null, nombre = "Productor $clave",
        rutaId = 3, rutaNombre = "Huata Norte", aprobado = true, estadoSync = EstadoSync.SINCRONIZADO,
        sancionado = false, bloqueado = false, sancionHasta = null, nHoy = nHoy, litrosHoy = litrosHoy,
    )

    @Test
    fun `sin entregas todo en cero, sin dejar de decir cuantos productores hay`() {
        val j = ResumenJornada.de(listOf(fila("a"), fila("b")))
        assertEquals("0.00 L", ResumenJornada.textoLitros(j))
        assertEquals("0 entregas", ResumenJornada.textoEntregas(j))
        assertEquals("0 de 2 productores atendidos", ResumenJornada.textoAtendidos(j))
    }

    @Test
    fun `suma litros y entregas y cuenta cada productor atendido una vez`() {
        val j = ResumenJornada.de(
            listOf(fila("a", nHoy = 2, litrosHoy = 23.5), fila("b", nHoy = 1, litrosHoy = 10.1), fila("c")),
        )
        assertEquals("33.60 L", ResumenJornada.textoLitros(j))
        assertEquals("3 entregas", ResumenJornada.textoEntregas(j))
        assertEquals("2 de 3 productores atendidos", ResumenJornada.textoAtendidos(j))
    }

    @Test
    fun `con un solo productor y una entrega va en singular`() {
        val j = ResumenJornada.de(listOf(fila("a", nHoy = 1, litrosHoy = 8.0)))
        assertEquals("1 entrega", ResumenJornada.textoEntregas(j))
        assertEquals("1 de 1 productor atendido", ResumenJornada.textoAtendidos(j))
    }

    @Test
    fun `sin productores bajados no se rompe`() {
        val j = ResumenJornada.de(emptyList())
        assertEquals("0.00 L", ResumenJornada.textoLitros(j))
        assertEquals("0 de 0 productores atendidos", ResumenJornada.textoAtendidos(j))
    }

    @Test
    fun `la insignia dice todo enviado solo si no hay pendientes ni rechazos`() {
        assertEquals(Insignia("✓ Todo enviado", TextosSync.Tono.BIEN), ResumenJornada.insignia(0, 0, true))
        assertEquals(Insignia("3 sin enviar", TextosSync.Tono.ADVERTENCIA), ResumenJornada.insignia(3, 0, true))
        assertEquals(
            Insignia("Sin señal · 3 sin enviar", TextosSync.Tono.ADVERTENCIA),
            ResumenJornada.insignia(3, 0, false),
        )
    }

    @Test
    fun `lo rechazado sin avisar pinta la insignia de rojo`() {
        assertEquals(Insignia("1 rechazada", TextosSync.Tono.ERROR), ResumenJornada.insignia(0, 1, true))
        assertEquals(
            Insignia("2 sin enviar · 3 rechazadas", TextosSync.Tono.ERROR),
            ResumenJornada.insignia(2, 3, true),
        )
    }
}
