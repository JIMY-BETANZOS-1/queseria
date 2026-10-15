package pe.queseria.campo.ui.productor

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import pe.queseria.campo.datos.local.EstadoSync
import pe.queseria.campo.datos.local.ProductorEntidad
import pe.queseria.campo.datos.local.RutaEntidad

/**
 * Cableado del aviso de duplicado de B5.
 *
 * Regresión que cubre (celular real, 0.4.0): "Prueba campo uno" se pudo crear dos veces sin un solo
 * aviso, aunque el primero ya estaba sincronizado y visible en B3 (P-0018 y P-0019 quedaron los dos).
 * La causa no estaba en [AltaProductor] —cuyas pruebas pasaban— sino aquí: la lista contra la que se
 * comparaba venía de un `stateIn(WhileSubscribed)` que nadie colectaba, así que llegaba vacía siempre y
 * el aviso era inalcanzable. Por eso estas pruebas ejercitan el ViewModel y no la función pura.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NuevoProductorViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun antes() = Dispatchers.setMain(dispatcher)

    @After
    fun despues() = Dispatchers.resetMain()

    private fun productor(
        nombre: String,
        documento: String? = null,
        estadoSync: String = EstadoSync.SINCRONIZADO,
        servidorId: Long? = 18,
        codigo: String? = "P-0018",
    ) = ProductorEntidad(
        clave = if (servidorId != null) "id:$servidorId" else "uuid-de-campo",
        servidorId = servidorId,
        uuidCliente = if (servidorId == null) "uuid-de-campo" else null,
        codigo = codigo, nombre = nombre, documento = documento, celular = null, rutaId = 1,
        latitudRef = null, longitudRef = null, aprobado = false, actualizadoEn = null,
        estadoSync = estadoSync, motivo = null, creadoEnMs = 0,
    )

    /** Lo que la pantalla le pasa al ViewModel, con la base y el Registrador falsos. */
    private class Entorno(val locales: List<ProductorEntidad>) {
        val creados = mutableListOf<String>()
        val clavesAvisadas = mutableListOf<String>()

        val vm = NuevoProductorViewModel(
            rutas = flowOf(listOf(RutaEntidad(1, "Ruta 1", null, "t"))),
            leerLocales = { locales },
            crear = { nombre, _, _, rutaId ->
                creados += nombre
                ProductorEntidad(
                    clave = "uuid-nuevo-${creados.size}", servidorId = null,
                    uuidCliente = "uuid-nuevo-${creados.size}", codigo = null, nombre = nombre,
                    documento = null, celular = null, rutaId = rutaId, latitudRef = null,
                    longitudRef = null, aprobado = false, actualizadoEn = null,
                    estadoSync = EstadoSync.PENDIENTE, motivo = null, creadoEnMs = 0,
                )
            },
        )

        /** Rellena el formulario como lo haría el acopiador. `prepararRuta` depende de la UI suscrita. */
        fun escribir(nombre: String, documento: String? = null) {
            vm.escribirNombre(nombre)
            documento?.let { vm.escribirDocumento(it) }
            vm.elegirRuta(1L)
        }

        fun guardar(forzar: Boolean = false) = vm.guardar(forzar) { clavesAvisadas += it }
    }

    // ─── El caso del fallo ────────────────────────────────────────────────────

    @Test
    fun `el nombre repetido de un productor ya sincronizado avisa y no crea nada`() = runTest(dispatcher) {
        val e = Entorno(listOf(productor("Prueba campo uno")))
        e.escribir("Prueba campo uno")

        e.guardar()
        advanceUntilIdle()

        val d = e.vm.formulario.value.duplicado
        assertTrue("debe avisar aunque el productor ya esté sincronizado", d != null)
        assertTrue("sin DNI la sospecha es por el nombre", !d!!.porDocumento)
        assertEquals("P-0018", d.productor.codigo)
        assertEquals("nada se guardó en el primer toque", emptyList<String>(), e.creados)
        assertNull(e.vm.formulario.value.error)
    }

    @Test
    fun `tambien avisa de un alta de campo todavia pendiente de enviar`() = runTest(dispatcher) {
        val pendiente = productor(
            "Prueba campo uno", estadoSync = EstadoSync.PENDIENTE, servidorId = null, codigo = null,
        )
        val e = Entorno(listOf(pendiente))
        e.escribir("prueba  CAMPO uno")   // mayúsculas y espacios de más: es el mismo nombre

        e.guardar()
        advanceUntilIdle()

        assertTrue(e.vm.formulario.value.duplicado != null)
        assertEquals(emptyList<String>(), e.creados)
    }

    @Test
    fun `el DNI repetido de un productor ya sincronizado avisa, y manda sobre el nombre`() =
        runTest(dispatcher) {
            val e = Entorno(listOf(productor("Juana Mamani", documento = "41234567")))
            e.escribir("Otra Persona", documento = "41234567")

            e.guardar()
            advanceUntilIdle()

            val d = e.vm.formulario.value.duplicado
            assertTrue("el DNI es UNIQUE: crear otro acaba en rechazo", d?.porDocumento == true)
            assertEquals("Juana Mamani", d!!.productor.nombre)
            assertEquals(emptyList<String>(), e.creados)
        }

    // ─── Que el aviso no bloquee ni se quede pegado ───────────────────────────

    @Test
    fun `avisa al primer toque y guarda al segundo`() = runTest(dispatcher) {
        val e = Entorno(listOf(productor("Prueba campo uno")))
        e.escribir("Prueba campo uno")

        e.guardar()
        advanceUntilIdle()
        assertTrue("primer toque: solo avisa", e.vm.formulario.value.duplicado != null)
        assertEquals(emptyList<String>(), e.creados)

        // "Crear igual": el aviso informa, nunca impide el alta
        e.guardar(forzar = true)
        advanceUntilIdle()

        assertEquals(listOf("Prueba campo uno"), e.creados)
        assertEquals("y se navega a B4 con el nuevo", listOf("uuid-nuevo-1"), e.clavesAvisadas)
    }

    @Test
    fun `editar el nombre borra el aviso`() = runTest(dispatcher) {
        val e = Entorno(listOf(productor("Prueba campo uno")))
        e.escribir("Prueba campo uno")
        e.guardar()
        advanceUntilIdle()
        assertTrue(e.vm.formulario.value.duplicado != null)

        e.vm.escribirNombre("Prueba campo dos")

        assertNull("corregido el nombre, el aviso ya no aplica", e.vm.formulario.value.duplicado)

        // Y al guardar de nuevo no hay duplicado: se crea sin pedir confirmación
        e.guardar()
        advanceUntilIdle()
        assertEquals(listOf("Prueba campo dos"), e.creados)
    }

    @Test
    fun `un nombre nuevo de verdad se guarda al primer toque`() = runTest(dispatcher) {
        val e = Entorno(listOf(productor("Prueba campo uno")))
        e.escribir("Pedro Quispe")

        e.guardar()
        advanceUntilIdle()

        assertNull("no se molesta al acopiador sin motivo", e.vm.formulario.value.duplicado)
        assertEquals(listOf("Pedro Quispe"), e.creados)
        assertEquals(listOf("uuid-nuevo-1"), e.clavesAvisadas)
    }

    @Test
    fun `sin ruta ni nombre no se crea nada y se explica por que`() = runTest(dispatcher) {
        val e = Entorno(emptyList())
        e.vm.escribirNombre("")

        e.guardar()
        advanceUntilIdle()

        assertEquals("Escriba el nombre del productor", e.vm.formulario.value.error)
        assertEquals(emptyList<String>(), e.creados)
    }
}
