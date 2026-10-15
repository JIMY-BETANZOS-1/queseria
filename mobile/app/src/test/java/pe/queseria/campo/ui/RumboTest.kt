package pe.queseria.campo.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import pe.queseria.campo.datos.local.EstadoSync
import pe.queseria.campo.datos.local.ProductorFila

/** Paso de B3 a B4, incluido el aviso de "otra entrega" que antes dejaba la navegación a medias. */
class RumboTest {

    private fun fila(clave: String = "id:7", nHoy: Int = 0, litrosHoy: Double = 0.0) = ProductorFila(
        clave = clave, servidorId = 7, uuidCliente = null, codigo = "P-0007", nombre = "Juana Mamani",
        rutaId = 3, rutaNombre = "Huata Norte", aprobado = true, estadoSync = EstadoSync.SINCRONIZADO,
        sancionado = false, bloqueado = false, sancionHasta = null, nHoy = nHoy, litrosHoy = litrosHoy,
    )

    @Test
    fun `la primera entrega del dia abre B4 directo`() {
        assertEquals(Destino.Registrar("id:7"), Rumbo.alTocarProductor(fila()))
    }

    @Test
    fun `productor con entregas hoy pide confirmar y al confirmar abre B4`() {
        val destino = Rumbo.alTocarProductor(fila(nHoy = 2, litrosHoy = 23.5))
        assertEquals("primero el aviso, sin salir de B3", Destino.Inicio(confirmar = "id:7"), destino)

        // El caso del fallo: "Sí, otra entrega" tiene que acabar en B4 con ese productor
        assertEquals(Destino.Registrar("id:7"), Rumbo.alConfirmarOtraEntrega(destino))
    }

    @Test
    fun `cancelar el aviso deja B3 sin el aviso`() {
        val destino = Rumbo.alTocarProductor(fila(nHoy = 1, litrosHoy = 8.0))
        assertEquals(Destino.Inicio(), Rumbo.alCancelarConfirmacion(destino))
    }

    @Test
    fun `atras cierra el aviso, luego vuelve de B4 a B3 y despues no hace nada`() {
        val conAviso = Destino.Inicio(confirmar = "id:7")
        assertEquals(Destino.Inicio(), Rumbo.atras(conAviso))
        assertEquals(Destino.Inicio(), Rumbo.atras(Destino.Registrar("id:7")))
        assertNull("en B3 limpio sale de la app", Rumbo.atras(Destino.Inicio()))
        assertNull(Rumbo.atras(Destino.Inicio(aviso = "✓ Registrado: 23.50 L · Juana Mamani")))
    }

    @Test
    fun `mientras el aviso esta abierto el gesto atras ya esta atendido`() {
        // Por esto no hay salto deshabilitado → habilitado al entrar a B4: el BackHandler ya estaba
        // activo con el aviso abierto y un atrás pendiente no se cuela como "volver a B3".
        val conAviso = Destino.Inicio(confirmar = "id:7")
        val enB4 = Rumbo.alConfirmarOtraEntrega(conAviso)
        assert(Rumbo.atras(conAviso) != null)
        assert(Rumbo.atras(enB4) != null)
    }

    @Test
    fun `confirmar o cancelar sin aviso abierto no mueve nada`() {
        val inicio = Destino.Inicio(aviso = "✓ Registrado: 8.00 L · Juana Mamani")
        assertEquals(inicio, Rumbo.alConfirmarOtraEntrega(inicio))
        assertEquals(inicio, Rumbo.alCancelarConfirmacion(inicio))
        val b4 = Destino.Registrar("id:7")
        assertEquals(b4, Rumbo.alConfirmarOtraEntrega(b4))
        assertEquals(b4, Rumbo.alCancelarConfirmacion(b4))
    }

    @Test
    fun `el aviso de confirmacion no se arrastra a B4`() {
        val destino = Rumbo.alConfirmarOtraEntrega(Destino.Inicio(confirmar = "uuid-de-campo"))
        assertEquals(Destino.Registrar("uuid-de-campo"), destino)
    }
}
