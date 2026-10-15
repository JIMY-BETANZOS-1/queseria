package pe.queseria.campo.ui.componentes

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * "Sin enviar" cuenta las recolecciones Y las altas de productor: un alta sin subir se pierde si el
 * celular se reinstala, y con ella la leche que la apunta por uuid_cliente.
 */
class TextosPendientesTest {

    @Test
    fun `sin nada pendiente no hay nada que decir`() {
        assertNull(TextosPendientes.contar(0, 0))
        assertEquals("Todo enviado", TextosPendientes.estado(0, 0))
    }

    @Test
    fun `una sola entrega va en singular`() {
        assertEquals("1 entrega", TextosPendientes.contar(1, 0))
        assertEquals("1 entrega sin enviar", TextosPendientes.estado(1, 0))
    }

    @Test
    fun `varias entregas van en plural`() {
        assertEquals("3 entregas", TextosPendientes.contar(3, 0))
        assertEquals("3 entregas sin enviar", TextosPendientes.estado(3, 0))
    }

    /** El caso que antes no avisaba de nada: un alta pendiente y ninguna recolección. */
    @Test
    fun `un alta de productor sola tambien cuenta`() {
        assertEquals("1 productor", TextosPendientes.contar(0, 1))
        assertEquals("1 productor sin enviar", TextosPendientes.estado(0, 1))
    }

    @Test
    fun `varios productores van en plural`() {
        assertEquals("2 productores", TextosPendientes.contar(0, 2))
    }

    @Test
    fun `las dos cosas a la vez se nombran juntas`() {
        assertEquals("2 entregas y 1 productor", TextosPendientes.contar(2, 1))
        assertEquals("2 entregas y 1 productor sin enviar", TextosPendientes.estado(2, 1))
        assertEquals("1 entrega y 2 productores", TextosPendientes.contar(1, 2))
    }
}
