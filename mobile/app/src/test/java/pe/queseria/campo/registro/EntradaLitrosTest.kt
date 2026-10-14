package pe.queseria.campo.registro

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import pe.queseria.campo.firma.Formato
import java.math.BigDecimal

/** Teclado de litros de B4: lo que se puede teclear y qué se considera un valor válido. */
class EntradaLitrosTest {

    private fun teclear(vararg teclas: Char): String =
        teclas.fold("") { texto, t ->
            if (t == '.') EntradaLitros.agregarPunto(texto) else EntradaLitros.agregarDigito(texto, t)
        }

    @Test
    fun `acumula digitos y acepta un decimal`() {
        assertEquals("23.5", teclear('2', '3', '.', '5'))
        assertEquals("23.55", teclear('2', '3', '.', '5', '5'))
    }

    @Test
    fun `no pasa de dos decimales`() {
        assertEquals("23.55", EntradaLitros.agregarDigito("23.55", '9'))
    }

    @Test
    fun `no pasa de cuatro enteros`() {
        assertEquals("1234", EntradaLitros.agregarDigito("1234", '5'))
    }

    @Test
    fun `un solo punto decimal`() {
        assertEquals("23.5", EntradaLitros.agregarPunto("23.5"))
        assertEquals("0.", EntradaLitros.agregarPunto(""))
    }

    @Test
    fun `el cero inicial no se acumula`() {
        assertEquals("5", EntradaLitros.agregarDigito("0", '5'))
        assertEquals("0", EntradaLitros.agregarDigito("0", '0'))
        assertEquals("0.5", teclear('0', '.', '5'))
    }

    @Test
    fun `borrar quita el ultimo caracter y el visor muestra cero`() {
        assertEquals("23.", EntradaLitros.borrar("23.5"))
        assertEquals("", EntradaLitros.borrar("2"))
        assertEquals("0", EntradaLitros.paraMostrar(""))
        assertEquals("23.", EntradaLitros.paraMostrar("23."))
    }

    @Test
    fun `solo es valido un valor mayor que cero`() {
        assertNull("vacío", EntradaLitros.valor(""))
        assertNull("cero", EntradaLitros.valor("0"))
        assertNull("cero con punto", EntradaLitros.valor("0."))
        assertNull("cero con decimales", EntradaLitros.valor("0.00"))
        assertEquals(BigDecimal("0.5"), EntradaLitros.valor("0.5"))
        assertEquals(BigDecimal("23.5"), EntradaLitros.valor("23.5"))
        assertEquals("se completa a 2 decimales al firmar", "23.50", Formato.litros(EntradaLitros.valor("23.5")!!))
    }
}
