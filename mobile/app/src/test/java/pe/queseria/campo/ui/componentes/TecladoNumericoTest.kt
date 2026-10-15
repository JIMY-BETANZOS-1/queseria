package pe.queseria.campo.ui.componentes

import org.junit.Assert.assertEquals
import org.junit.Test

/** El teclado de litros (B4) va en orden fijo; el barajado es solo del PIN (B2). */
class TecladoNumericoTest {

    @Test
    fun `sin mezclar sale 1-2-3 arriba y el 0 al final`() {
        assertEquals(listOf(1, 2, 3, 4, 5, 6, 7, 8, 9, 0), digitosTeclado(mezclar = false))
    }

    @Test
    fun `las filas de B4 quedan 123 456 789`() {
        val d = digitosTeclado(mezclar = false)
        assertEquals(listOf(1, 2, 3), d.subList(0, 3))
        assertEquals(listOf(4, 5, 6), d.subList(3, 6))
        assertEquals(listOf(7, 8, 9), d.subList(6, 9))
        assertEquals("la última fila lleva el 0 entre el punto y el borrar", 0, d[9])
    }

    @Test
    fun `mezclado sigue teniendo los diez digitos una sola vez`() {
        repeat(20) {
            val d = digitosTeclado(mezclar = true)
            assertEquals(10, d.size)
            assertEquals((0..9).toList(), d.sorted())
        }
    }

    @Test
    fun `el orden fijo no se puede alterar desde fuera`() {
        assertEquals(ORDEN_FIJO, digitosTeclado(mezclar = false))
        assertEquals("se reparte el mismo orden siempre", digitosTeclado(false), digitosTeclado(false))
    }
}
