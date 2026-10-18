package pe.queseria.campo.ui.activar

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import pe.queseria.campo.datos.remoto.ErrorApp

/** B1: código → cree su PIN → repita su PIN → activar, con cada error devolviendo a la etapa correcta. */
@OptIn(ExperimentalCoroutinesApi::class)
class ActivarViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun antes() = Dispatchers.setMain(dispatcher)

    @After
    fun despues() = Dispatchers.resetMain()

    private val llamadas = mutableListOf<Pair<String, String>>()
    private var respuesta: () -> Unit = {}

    private fun vm() = ActivarViewModel { codigo, pin ->
        llamadas += codigo to pin
        respuesta()
    }

    private fun ActivarViewModel.hastaCrearPin() {
        escribirCodigo("abcd-2345")
        siguiente()
    }

    @Test
    fun `el codigo se normaliza y sin 8 caracteres no avanza`() {
        val vm = vm()
        vm.escribirCodigo("abc 23")
        assertEquals("ABC23", vm.codigo.value)
        vm.siguiente()
        assertTrue(vm.etapa.value is EtapaActivar.Codigo)
        vm.escribirCodigo("abcd-2345-xyz")
        assertEquals("ABCD2345", vm.codigo.value)
        vm.siguiente()
        assertTrue(vm.etapa.value is EtapaActivar.CrearPin)
    }

    @Test
    fun `flujo completo activa con el codigo y el PIN`() = runTest(dispatcher) {
        val vm = vm()
        vm.hastaCrearPin()
        vm.pinCreado("4821")
        assertEquals(EtapaActivar.RepetirPin, vm.etapa.value)
        vm.pinRepetido("4821")
        assertEquals(EtapaActivar.Cargando, vm.etapa.value)
        advanceUntilIdle()
        assertEquals(listOf("ABCD2345" to "4821"), llamadas)
    }

    @Test
    fun `un PIN trivial se avisa sin llamar al servidor`() {
        val vm = vm()
        vm.hastaCrearPin()
        vm.pinCreado("1234")
        val e = vm.etapa.value as EtapaActivar.CrearPin
        assertEquals("Elija un PIN menos obvio: es una secuencia", e.error)
        assertTrue(llamadas.isEmpty())
    }

    @Test
    fun `dos errores iguales seguidos siguen siendo estados distintos`() {
        // Si no, lo tecleado no se reinicia y el teclado queda trabado en 4 dígitos
        val vm = vm()
        vm.hastaCrearPin()
        vm.pinCreado("1234")
        val primero = vm.etapa.value
        vm.pinCreado("2345")
        assertNotEquals(primero, vm.etapa.value)
        assertEquals((primero as EtapaActivar.CrearPin).error, (vm.etapa.value as EtapaActivar.CrearPin).error)
    }

    @Test
    fun `si no coinciden vuelve a crear el PIN sin llamar al servidor`() {
        val vm = vm()
        vm.hastaCrearPin()
        vm.pinCreado("4821")
        vm.pinRepetido("4822")
        assertEquals("Los PIN no coinciden. Vuelva a crearlo", (vm.etapa.value as EtapaActivar.CrearPin).error)
        assertTrue(llamadas.isEmpty())
        // Y el primero ya no vale: hay que crearlo de nuevo
        vm.pinRepetido("4821")
        assertTrue(llamadas.isEmpty())
    }

    @Test
    fun `422 del servidor vuelve a crear el PIN y conserva el codigo`() = runTest(dispatcher) {
        respuesta = { throw ErrorApp.Validacion("Elija un PIN menos obvio: son los últimos dígitos de su DNI") }
        val vm = vm()
        vm.hastaCrearPin()
        vm.pinCreado("7319")
        vm.pinRepetido("7319")
        advanceUntilIdle()
        assertEquals(
            "Elija un PIN menos obvio: son los últimos dígitos de su DNI",
            (vm.etapa.value as EtapaActivar.CrearPin).error,
        )
        assertEquals("ABCD2345", vm.codigo.value)
    }

    @Test
    fun `codigo invalido, sin red o sincronice primero vuelven al codigo con el mensaje`() = runTest(dispatcher) {
        val errores = listOf(
            ErrorApp.NoAutorizado("Código inválido, vencido o ya usado"),
            ErrorApp.SinRed(),
            ErrorApp.DemasiadosIntentos("Demasiados códigos incorrectos. Intente en unos minutos"),
            ErrorApp.Local("Sincronice primero: quedan 2 entregas sin enviar. Si no puede, avise al administrador."),
        )
        for (error in errores) {
            respuesta = { throw error }
            val vm = vm()
            vm.hastaCrearPin()
            vm.pinCreado("4821")
            vm.pinRepetido("4821")
            advanceUntilIdle()
            assertEquals(EtapaActivar.Codigo(error = error.message), vm.etapa.value)
        }
    }

    @Test
    fun `cambiar codigo vuelve a la primera etapa`() {
        val vm = vm()
        vm.hastaCrearPin()
        vm.pinCreado("4821")
        vm.cambiarCodigo()
        assertEquals(EtapaActivar.Codigo(), vm.etapa.value)
        vm.siguiente()
        vm.pinRepetido("4821")      // el PIN de antes se olvidó
        assertTrue(llamadas.isEmpty())
    }
}
