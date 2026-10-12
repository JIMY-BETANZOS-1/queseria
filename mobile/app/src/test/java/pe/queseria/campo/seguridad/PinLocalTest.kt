package pe.queseria.campo.seguridad

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PinLocalTest {
    private class Memoria : AlmacenClaves {
        val datos = mutableMapOf<String, String>()
        override fun leer(clave: String) = datos[clave]
        override fun guardar(clave: String, valor: String?) {
            if (valor == null) datos.remove(clave) else datos[clave] = valor
        }
    }

    private var ahora = 1_000_000L
    private val almacen = Memoria()
    private val pin = PinLocal(almacen) { ahora }

    @Test
    fun `sin verificador pide ingresar con red`() {
        assertEquals(ResultadoPin.SinVerificador, pin.verificar("1234"))
    }

    @Test
    fun `valida el PIN guardado y no guarda el PIN en claro`() {
        pin.guardar("1234")
        assertEquals(ResultadoPin.Correcto, pin.verificar("1234"))
        assertEquals(ResultadoPin.Incorrecto(4), pin.verificar("9999"))
        assertTrue(almacen.datos.values.none { it.contains("1234") })
    }

    @Test
    fun `bloquea tras 5 fallos durante 15 minutos`() {
        pin.guardar("1234")
        repeat(4) { pin.verificar("0000") }
        assertEquals(ResultadoPin.Bloqueado(ahora + PinLocal.BLOQUEO_MS), pin.verificar("0000"))
        // Bloqueado: ni el PIN correcto entra
        assertTrue(pin.verificar("1234") is ResultadoPin.Bloqueado)
        ahora += PinLocal.BLOQUEO_MS + 1
        assertEquals(ResultadoPin.Correcto, pin.verificar("1234"))
    }

    @Test
    fun `un acierto reinicia el contador de fallos`() {
        pin.guardar("1234")
        repeat(4) { pin.verificar("0000") }
        assertEquals(ResultadoPin.Correcto, pin.verificar("1234"))
        assertEquals(ResultadoPin.Incorrecto(4), pin.verificar("0000"))
    }
}
