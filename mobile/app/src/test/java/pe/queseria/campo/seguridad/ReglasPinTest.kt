package pe.queseria.campo.seguridad

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mismos casos que backend/tests/test_pin_reglas.py: el celular avisa igual que decide el servidor. */
class ReglasPinTest {

    @Test
    fun `el PIN es de exactamente 4 digitos`() {
        assertTrue(ReglasPin.formatoValido("4821"))
        for (malo in listOf("", "123", "12345", "123456", "12a4", "12 4")) assertFalse(malo, ReglasPin.formatoValido(malo))
    }

    @Test
    fun `todos iguales`() {
        for (pin in listOf("0000", "1111", "9999")) assertEquals(pin, "todos los dígitos son iguales", ReglasPin.trivial(pin))
    }

    @Test
    fun `secuencias de subida y de bajada`() {
        for (pin in listOf("0123", "1234", "6789", "9876", "4321", "3210")) {
            assertEquals(pin, "es una secuencia", ReglasPin.trivial(pin))
        }
    }

    @Test
    fun `par repetido y dobles`() {
        for (pin in listOf("1212", "1010", "2121", "9090")) assertEquals(pin, "repite un par de dígitos", ReglasPin.trivial(pin))
        for (pin in listOf("1122", "0011", "9988")) assertEquals(pin, "repite dígitos de a dos", ReglasPin.trivial(pin))
    }

    @Test
    fun `ultimos digitos del DNI o del celular`() {
        assertEquals("son los últimos dígitos de su DNI", ReglasPin.trivial("7319", dni = "41237319"))
        assertEquals("son los últimos dígitos de su celular", ReglasPin.trivial("8426", celular = "951238426"))
        assertNull(ReglasPin.trivial("7319", dni = "41238426", celular = "951237318"))
    }

    @Test
    fun `pines aceptados`() {
        for (pin in listOf("1357", "2580", "7319", "1221", "8901", "0987")) assertNull(pin, ReglasPin.trivial(pin))
    }

    @Test
    fun `se rechazan exactamente 204 de 10000, igual que el backend`() {
        val rechazados = (0 until 10_000).map { "%04d".format(it) }.count { ReglasPin.trivial(it) != null }
        assertEquals(204, rechazados)
    }
}
