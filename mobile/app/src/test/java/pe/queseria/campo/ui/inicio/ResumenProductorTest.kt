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
    fun `estado del dia pendiente o con los litros ya registrados`() {
        assertEquals("Pendiente", ResumenProductor.estadoDelDia(fila()))
        assertEquals("✓ 22.50 L hoy", ResumenProductor.estadoDelDia(fila(nHoy = 2, litrosHoy = 22.5)))
        assertEquals("✓ 8.00 L hoy", ResumenProductor.estadoDelDia(fila(nHoy = 1, litrosHoy = 8.0)))
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
