package pe.queseria.campo.ui.pin

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** B2 sin botón OK: se envía solo al 4.º dígito, una sola vez; lo incompleto nunca se envía. */
class EntradaPinTest {

    /** Teclea [digitos] uno a uno y devuelve el PIN final y cuántas veces se habría enviado. */
    private fun teclear(digitos: String, desde: String = ""): Pair<String, Int> {
        var pin = desde
        var envios = 0
        for (d in digitos) {
            val paso = EntradaPin.teclear(pin, d)
            pin = paso.pin
            if (paso.enviar) envios++
        }
        return pin to envios
    }

    @Test
    fun `de 1 a 3 digitos nunca se envia`() {
        for (n in 1..3) {
            val (pin, envios) = teclear("482".take(n))
            assertEquals(n, pin.length)
            assertEquals("Una entrada incompleta no se envía ni cuenta como intento", 0, envios)
        }
    }

    @Test
    fun `el 4to digito envia exactamente una vez`() {
        val (pin, envios) = teclear("4821")
        assertEquals("4821", pin)
        assertEquals(1, envios)
    }

    @Test
    fun `toques de mas despues del 4to no agregan ni vuelven a enviar`() {
        val (pin, envios) = teclear("482199")
        assertEquals("4821", pin)
        assertEquals("Un doble toque no cuenta dos intentos", 1, envios)
    }

    @Test
    fun `borrar y completar de nuevo vuelve a enviar una vez`() {
        val (pin, _) = teclear("482")
        val corregido = EntradaPin.borrar(pin)
        assertEquals("48", corregido)
        val (final, envios) = teclear("27", desde = corregido)
        assertEquals("4827", final)
        assertEquals(1, envios)
        assertEquals("", EntradaPin.borrar(""))
    }

    @Test
    fun `solo se aceptan digitos`() {
        val paso = EntradaPin.teclear("48", 'x')
        assertEquals("48", paso.pin)
        assertFalse(paso.enviar)
        assertTrue(EntradaPin.teclear("482", '0').enviar)
    }
}
