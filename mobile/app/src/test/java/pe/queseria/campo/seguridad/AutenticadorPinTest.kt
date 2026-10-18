package pe.queseria.campo.seguridad

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import pe.queseria.campo.datos.remoto.ActivarDto
import pe.queseria.campo.datos.remoto.ApiQueseria
import pe.queseria.campo.datos.remoto.DispositivoActivadoDto
import pe.queseria.campo.datos.remoto.ErrorApp
import pe.queseria.campo.datos.remoto.LotePushDto
import pe.queseria.campo.datos.remoto.LoginPinDto
import pe.queseria.campo.datos.remoto.MiDiaDto
import pe.queseria.campo.datos.remoto.PullAcopiadorDto
import pe.queseria.campo.datos.remoto.RespuestaPushDto
import pe.queseria.campo.datos.remoto.TokenMovilDto
import pe.queseria.campo.datos.remoto.UsuarioSesionDto
import java.io.IOException
import java.net.SocketTimeoutException

/**
 * Ingreso con PIN del acopiador: con señal manda el servidor, sin señal manda [PinLocal].
 *
 * Regresión que cubren estos casos (celular Realme C11, fase 3B): un bloqueo local arrastrado de
 * pruebas anteriores vetaba la llamada al servidor, así que nunca se obtenía token, y sin token
 * nunca se guardaba el verificador — el celular quedaba sin poder entrar nunca más.
 */
class AutenticadorPinTest {

    private val usuario = UsuarioSesionDto(id = 7, rol = "acopiador", nombreCompleto = "Juan Mamani")

    /** Almacén en memoria que sobrevive entre instancias, como las preferencias del celular. */
    private class Memoria : AlmacenClaves {
        val datos = mutableMapOf<String, String>()
        override fun leer(clave: String) = datos[clave]
        override fun guardar(clave: String, valor: String?) {
            if (valor == null) datos.remove(clave) else datos[clave] = valor
        }
    }

    private class ApiFalsa(private val usuario: UsuarioSesionDto) : ApiQueseria {
        /** false simula estar en el campo sin señal (Retrofit lanza IOException). */
        var conRed = true

        /** false = el admin desactivó el celular (POST /dispositivos/{id}/desactivar). */
        var dispositivoActivo = true
        var pinDelServidor = "1234"
        var loginsPedidos = 0

        /** true = PIN puesto por el admin antes del Bloque 6: el backend responde 401 debe_reactivar. */
        var debeReactivar = false

        /** Qué falla de red simular: sin señal, o el servidor que no contesta en 4 s. */
        var fallaDeRed: () -> IOException = { IOException("sin señal") }

        var activacionesPedidas = 0
        var ultimaActivacion: ActivarDto? = null

        /** Como el backend: un código inválido es 401; si sale bien, el PIN nuevo pasa a ser el del servidor. */
        var codigoValido = true

        override suspend fun activar(cuerpo: ActivarDto): DispositivoActivadoDto {
            activacionesPedidas++
            if (!conRed) throw fallaDeRed()
            if (!codigoValido) throw ErrorApp.NoAutorizado("Código inválido, vencido o ya usado")
            ultimaActivacion = cuerpo
            pinDelServidor = cuerpo.pin
            debeReactivar = false           // el backend pone pin_actualizado_en = now()
            return DispositivoActivadoDto(
                dispositivoId = 3, activadoEn = "2026-10-13T08:00:00", usuario = usuario,
                accessToken = "jwt-de-activacion", expiraEnMin = 60,
            )
        }

        override suspend fun loginPin(cuerpo: LoginPinDto): TokenMovilDto {
            loginsPedidos++
            if (!conRed) throw fallaDeRed()
            // El backend comprueba el celular antes del PIN (backend/app/routers/auth.py:140)
            if (!dispositivoActivo) {
                throw ErrorApp.DispositivoNoVinculado("Este celular no está vinculado o fue desactivado")
            }
            if (debeReactivar) {
                throw ErrorApp.DebeReactivar("Pida un código nuevo al administrador para crear su PIN")
            }
            if (cuerpo.pin != pinDelServidor) throw ErrorApp.NoAutorizado("PIN incorrecto")
            return TokenMovilDto(
                accessToken = "jwt-de-prueba",
                expiraEnMin = 60,
                dispositivoId = 3,
                usuario = usuario,
            )
        }

        override suspend fun push(bearer: String, lote: LotePushDto): RespuestaPushDto =
            error("no se usa en estas pruebas")

        override suspend fun pull(bearer: String, desde: String?): PullAcopiadorDto =
            error("no se usa en estas pruebas")

        override suspend fun miDia(bearer: String): MiDiaDto =
            error("no se usa en estas pruebas")
    }

    private val almacen = Memoria()
    private val api = ApiFalsa(usuario)
    private var ahora = 1_700_000_000_000L
    private val pinLocal = PinLocal(almacen) { ahora }
    private val auth = Autenticador(
        api = api,
        almacen = almacen,
        clavePublica = { "clave-publica-de-prueba" },
        pin = pinLocal,
        modelo = "realme RMX3231",
        reloj = { ahora },
    )

    /** Deja el celular vinculado y con un ingreso online correcto: el estado normal en campo. */
    private suspend fun vincularEIngresarConSenal() {
        auth.activar("ABC123", "1234")
        auth.ingresar("1234")
    }

    private suspend inline fun <reified E : Throwable> capturar(bloque: () -> Unit): E {
        try {
            bloque()
        } catch (e: Throwable) {
            if (e is E) return e
            throw AssertionError("Se esperaba ${E::class.simpleName} y vino ${e::class.simpleName}: ${e.message}")
        }
        throw AssertionError("Se esperaba ${E::class.simpleName} y no hubo ninguna excepción")
    }

    @Test
    fun `la activacion guarda el verificador y el token y abre la sesion`() = runTest {
        val abierta = auth.activar("ABC123", "4821")

        assertTrue("Con señal y sin otro login: el servidor acaba de aceptar el PIN", abierta.conServidor)
        assertEquals(abierta, auth.estado.value)
        assertTrue("Ya se puede entrar sin señal con el PIN recién creado", pinLocal.tieneVerificador())
        assertEquals("jwt-de-activacion", auth.tokenVigente())
        assertEquals("4821", api.ultimaActivacion?.pin)
        assertTrue("El PIN no se guarda en claro", almacen.datos.values.none { it.contains("4821") })
        api.conRed = false
        assertFalse(auth.ingresar("4821").conServidor)
    }

    @Test
    fun `el ingreso online repone el verificador local si falta`() = runTest {
        auth.activar("ABC123", "1234")
        pinLocal.borrar()           // p. ej. un celular que venía de una versión anterior

        auth.ingresar("1234")

        assertTrue("Tras aceptar el PIN el servidor, debe quedar el hash local", pinLocal.tieneVerificador())
        assertNotNull("Debe quedar token para sincronizar", auth.tokenVigente())
        assertTrue("El PIN no se guarda en claro", almacen.datos.values.none { it.contains("1234") })
    }

    @Test
    fun `el PIN correcto entra sin red`() = runTest {
        vincularEIngresarConSenal()

        api.conRed = false
        val abierta = auth.ingresar("1234")

        assertEquals(7L, abierta.usuario.id)
        assertEquals("acopiador", abierta.usuario.rol)
        assertFalse("Sin red la sesión se abre con el verificador local", abierta.conServidor)
    }

    @Test
    fun `sin red cuatro fallos no bloquean y el quinto si`() = runTest {
        vincularEIngresarConSenal()
        api.conRed = false

        repeat(4) { intento ->
            val e = capturar<ErrorApp.NoAutorizado> { auth.ingresar("0000") }
            assertTrue(
                "El intento ${intento + 1} debe avisar cuántos quedan, no bloquear: ${e.message}",
                e.message!!.contains("PIN incorrecto"),
            )
            assertNull("No debe haber bloqueo en el intento ${intento + 1}", auth.bloqueadoHasta())
        }

        capturar<ErrorApp.PinBloqueado> { auth.ingresar("0000") }
        assertEquals(ahora + PinLocal.BLOQUEO_MS, auth.bloqueadoHasta())
    }

    @Test
    fun `un error de red nunca cuenta como intento fallido`() = runTest {
        vincularEIngresarConSenal()
        api.conRed = false

        // Muchos más ingresos correctos que el máximo de intentos: la falta de señal no acumula fallos
        repeat(PinLocal.MAX_INTENTOS + 3) {
            assertFalse(auth.ingresar("1234").conServidor)
            assertNull("Un error de red no puede bloquear el PIN", auth.bloqueadoHasta())
        }
    }

    @Test
    fun `sin verificador y sin red los reintentos no bloquean`() = runTest {
        // Vinculado pero sin verificador (desde el Bloque 6 la activación lo guarda; esto es un celular
        // que venía de una versión anterior): no hay con qué validar sin señal
        auth.activar("ABC123", "1234")
        pinLocal.borrar()
        api.conRed = false

        repeat(PinLocal.MAX_INTENTOS + 2) {
            val e = capturar<ErrorApp.Local> { auth.ingresar("1234") }
            assertTrue(e.message!!.contains("necesita señal"))
            assertNull("Pedir señal no es un intento fallido", auth.bloqueadoHasta())
        }
    }

    @Test
    fun `un ingreso correcto reinicia el contador de fallos`() = runTest {
        vincularEIngresarConSenal()
        api.conRed = false

        repeat(4) { capturar<ErrorApp.NoAutorizado> { auth.ingresar("0000") } }
        assertFalse(auth.ingresar("1234").conServidor)

        // Si el contador no se hubiera reiniciado, este fallo sería el quinto y bloquearía
        val e = capturar<ErrorApp.NoAutorizado> { auth.ingresar("0000") }
        assertTrue("Debe volver a contar desde cero: ${e.message}", e.message!!.contains("4 intentos"))
        assertNull(auth.bloqueadoHasta())
    }

    @Test
    fun `un bloqueo local viejo no impide entrar con senal`() = runTest {
        vincularEIngresarConSenal()

        // Bloqueo arrastrado de pruebas anteriores (lo que tenía el Realme en pin_bloqueado_hasta)
        pinLocal.bloquear()
        assertNotNull(auth.bloqueadoHasta())

        // Con señal manda el servidor: acepta el PIN, abre sesión y limpia el bloqueo del celular
        val abierta = auth.ingresar("1234")

        assertTrue("Con señal el servidor es la autoridad", abierta.conServidor)
        assertNull("Un ingreso aceptado limpia el bloqueo local", auth.bloqueadoHasta())
    }

    @Test
    fun `con bloqueo local y sin red no deja entrar`() = runTest {
        vincularEIngresarConSenal()
        pinLocal.bloquear()
        api.conRed = false

        // Sin servidor que decida, el bloqueo local sí manda: ni el PIN correcto entra
        capturar<ErrorApp.PinBloqueado> { auth.ingresar("1234") }

        ahora += PinLocal.BLOQUEO_MS + 1
        assertFalse("Al vencer el bloqueo vuelve a entrar sin red", auth.ingresar("1234").conServidor)
    }

    // ─── 1. Con red siempre se consulta al servidor ───────────────────────────

    @Test
    fun `con red el ingreso consulta al servidor antes del verificador local`() = runTest {
        vincularEIngresarConSenal()
        val antes = api.loginsPedidos

        auth.ingresar("1234")

        assertEquals("Cada ingreso con red debe llamar a /auth/pin/login", antes + 1, api.loginsPedidos)
    }

    @Test
    fun `con red un celular desactivado no entra aunque el PIN local sea correcto`() = runTest {
        vincularEIngresarConSenal()
        assertTrue("El verificador local aceptaría este PIN", pinLocal.tieneVerificador())

        // El admin lo desactiva mientras el celular tiene wifi
        api.dispositivoActivo = false
        capturar<ErrorApp.DispositivoNoVinculado> { auth.ingresar("1234") }

        // Y tampoco entra al reintentar: ya no queda con qué validar sin red
        capturar<ErrorApp.Local> { auth.ingresar("1234") }
    }

    // ─── 2. dispositivo_no_vinculado deja el celular listo para revincular ────

    @Test
    fun `desvincular borra token y verificador y pide codigo nuevo`() = runTest {
        vincularEIngresarConSenal()
        api.dispositivoActivo = false

        val e = capturar<ErrorApp.DispositivoNoVinculado> { auth.ingresar("1234") }

        assertEquals(Autenticador.MSG_DESVINCULADO, e.message)
        assertFalse("El verificador local debe desaparecer", pinLocal.tieneVerificador())
        assertNull("El token debe desaparecer", auth.tokenVigente())
        assertEquals(
            "La app debe volver a la pantalla de vincular, con el motivo",
            EstadoSesion.SinVincular(Autenticador.MSG_DESVINCULADO),
            auth.estado.value,
        )
        // El device_uuid identifica al aparato: se conserva para la nueva activación
        assertTrue(almacen.datos.containsKey("device_uuid"))
        assertFalse(almacen.datos.containsKey("usuario_id"))
    }

    @Test
    fun `tras desvincular se puede volver a vincular y entrar`() = runTest {
        vincularEIngresarConSenal()
        val device = auth.deviceUuid()
        api.dispositivoActivo = false
        capturar<ErrorApp.DispositivoNoVinculado> { auth.ingresar("1234") }

        // El admin genera un código nuevo y el acopiador vuelve a vincular el mismo celular
        api.dispositivoActivo = true
        auth.activar("NUEVO123", "1234")
        assertEquals("El mismo aparato, no uno nuevo", device, auth.deviceUuid())

        assertTrue(auth.ingresar("1234").conServidor)
        assertTrue("Y vuelve a quedar listo para el campo", pinLocal.tieneVerificador())
    }

    // ─── 3. Sin red o con timeout manda el verificador local ─────────────────

    @Test
    fun `si el servidor no contesta en el timeout se valida localmente`() = runTest {
        vincularEIngresarConSenal()

        // El timeout corto de /auth/pin/login llega a Retrofit como SocketTimeoutException
        api.conRed = false
        api.fallaDeRed = { SocketTimeoutException("timeout") }

        repeat(PinLocal.MAX_INTENTOS + 2) {
            assertFalse("Debe entrar con el PIN local", auth.ingresar("1234").conServidor)
            assertNull("Un timeout no es un PIN incorrecto", auth.bloqueadoHasta())
        }
    }

    // ─── 4. El PIN incorrecto del servidor cuenta como intento fallido ───────

    @Test
    fun `el PIN rechazado por el servidor cuenta como intento fallido`() = runTest {
        vincularEIngresarConSenal()

        repeat(4) { intento ->
            capturar<ErrorApp.NoAutorizado> { auth.ingresar("0000") }
            assertNull("El fallo ${intento + 1} del servidor aún no bloquea", auth.bloqueadoHasta())
        }
        capturar<ErrorApp.NoAutorizado> { auth.ingresar("0000") }

        assertEquals(
            "Cinco rechazos del servidor bloquean igual que cinco locales",
            ahora + PinLocal.BLOQUEO_MS,
            auth.bloqueadoHasta(),
        )
    }

    // ─── 5. Sin cambio de PIN obligatorio (B2b y opción C se quitaron en el Bloque 6) ──

    /**
     * Un celular que venía de la 0.5.0 con el cambio de PIN pendiente guardado: ya no se exige nada
     * (el PIN lo crea el propio usuario al activar) y el dato viejo se limpia en el primer ingreso.
     */
    @Test
    fun `el pendiente de cambio de PIN de una version anterior se ignora y se limpia`() = runTest {
        vincularEIngresarConSenal()
        almacen.guardar("debe_cambiar_pin", "1")

        val s = auth.ingresar("1234")

        assertTrue("Entra directo a trabajar", s.conServidor)
        assertFalse(almacen.datos.containsKey("debe_cambiar_pin"))
    }

    // ─── Bloque 6: PIN de 4 dígitos, debe_reactivar y "¿Olvidó su PIN?" ──────

    @Test
    fun `un PIN que no es de 4 digitos no llega al servidor ni cuenta como intento`() = runTest {
        vincularEIngresarConSenal()
        val antes = api.loginsPedidos
        for (malo in listOf("123", "12345", "123456", "12a4")) {
            capturar<ErrorApp.Validacion> { auth.ingresar(malo) }
        }
        assertEquals("Nada se envió al servidor", antes, api.loginsPedidos)
        api.conRed = false
        assertFalse("Sin red entra con el verificador local", auth.ingresar("1234").conServidor)
        assertFalse("Ni el verificador local sumó fallos", almacen.datos.containsKey("pin_fallos"))
        assertNull(auth.bloqueadoHasta())
    }

    @Test
    fun `debe_reactivar vuelve a vincular sin contar fallo y conserva el aparato`() = runTest {
        vincularEIngresarConSenal()
        val device = auth.deviceUuid()
        api.debeReactivar = true

        val e = capturar<ErrorApp.DebeReactivar> { auth.ingresar("1234") }

        assertEquals(Autenticador.MSG_DEBE_REACTIVAR, e.message)
        assertEquals(EstadoSesion.SinVincular(Autenticador.MSG_DEBE_REACTIVAR), auth.estado.value)
        assertNull("No es un fallo de PIN: no hay bloqueo local", auth.bloqueadoHasta())
        assertFalse(almacen.datos.containsKey("pin_fallos"))
        assertEquals("El mismo aparato para reactivar", device, auth.deviceUuid())
    }

    @Test
    fun `olvide mi PIN va a vincular sin borrar nada y se puede volver`() = runTest {
        vincularEIngresarConSenal()
        auth.cerrarSesion()
        val antes = almacen.datos.toMap()

        auth.irAActivar()
        assertEquals(EstadoSesion.SinVincular(motivo = null, puedeVolver = true), auth.estado.value)
        assertEquals("No se borró nada: ni sesión, ni token, ni verificador", antes, almacen.datos)

        auth.volverAlPin()
        assertEquals(EstadoSesion.Cerrada(UsuarioLocal(7, "acopiador", "Juan Mamani")), auth.estado.value)
        api.conRed = false
        assertFalse("El PIN de siempre sigue sirviendo", auth.ingresar("1234").conServidor)
    }

    @Test
    fun `sin celular vinculado olvide mi PIN no ofrece volver`() {
        auth.irAActivar()
        assertEquals(EstadoSesion.SinVincular(motivo = null, puedeVolver = false), auth.estado.value)
    }

    // ─── Bloque 6: activación con PIN propio y reactivación sin perder nada ───

    private var clavesPedidas = 0

    /** Mismo almacén, servidor y verificador que [auth], con lo que falta sincronizar y la clave a elección. */
    private fun autenticadorCon(pendientes: String?, claveExiste: Boolean) = Autenticador(
        api = api,
        almacen = almacen,
        clavePublica = { clavesPedidas++; "clave-publica-de-prueba" },
        pin = pinLocal,
        modelo = "realme RMX3231",
        reloj = { ahora },
        pendientesSinEnviar = { pendientes },
        claveFirmaExiste = { claveExiste },
    )

    @Test
    fun `reactivar con un PIN nuevo quita el bloqueo local y el PIN viejo deja de servir`() = runTest {
        vincularEIngresarConSenal()
        api.conRed = false
        repeat(PinLocal.MAX_INTENTOS) { runCatching { auth.ingresar("0000") } }
        assertNotNull("Quedó bloqueado en el celular", auth.bloqueadoHasta())

        api.conRed = true
        auth.irAActivar()
        auth.activar("NUEVO123", "7319")

        assertNull("La reactivación limpia el bloqueo local", auth.bloqueadoHasta())
        api.conRed = false
        capturar<ErrorApp.NoAutorizado> { auth.ingresar("1234") }
        assertFalse(auth.ingresar("7319").conServidor)
    }

    @Test
    fun `reactivar conserva el aparato y reutiliza la clave de firma`() = runTest {
        val a = autenticadorCon(pendientes = "2 entregas", claveExiste = true)
        a.activar("ABC123", "1234")
        val device = a.deviceUuid()
        val primera = api.ultimaActivacion!!

        a.irAActivar()
        a.activar("NUEVO123", "7319")

        assertEquals("El mismo aparato: el servidor reutiliza su fila de dispositivo", device, a.deviceUuid())
        assertEquals(device, api.ultimaActivacion!!.deviceUuid)
        assertEquals("La misma clave pública: lo pendiente sigue bien firmado",
            primera.clavePublica, api.ultimaActivacion!!.clavePublica)
    }

    @Test
    fun `con pendientes y sin clave de firma no se reactiva y pide sincronizar primero`() = runTest {
        val a = autenticadorCon(pendientes = "2 entregas y 1 productor", claveExiste = false)
        val antes = almacen.datos.toMap()

        val e = capturar<ErrorApp.Local> { a.activar("ABC123", "4821") }

        assertEquals(
            "Sincronice primero: quedan 2 entregas y 1 productor sin enviar. Si no puede, avise al administrador.",
            e.message,
        )
        assertEquals("No se llamó al servidor", 0, api.activacionesPedidas)
        assertEquals("Ni se creó una clave nueva (invalidaría lo pendiente)", 0, clavesPedidas)
        assertEquals("Nada cambió en el celular", antes, almacen.datos)
    }

    @Test
    fun `sin pendientes se activa aunque haya que crear la clave de firma`() = runTest {
        val a = autenticadorCon(pendientes = null, claveExiste = false)
        assertTrue(a.activar("ABC123", "4821").conServidor)
        assertEquals(1, clavesPedidas)
    }

    @Test
    fun `con pendientes y con su clave de firma se reactiva normal`() = runTest {
        val a = autenticadorCon(pendientes = "3 entregas", claveExiste = true)
        assertTrue(a.activar("ABC123", "4821").conServidor)
        assertEquals(1, api.activacionesPedidas)
    }

    @Test
    fun `si la activacion falla no queda nada a medias`() = runTest {
        vincularEIngresarConSenal()
        auth.cerrarSesion()
        auth.irAActivar()
        val antes = almacen.datos.toMap()

        api.conRed = false
        capturar<ErrorApp.SinRed> { auth.activar("NUEVO123", "7319") }
        api.conRed = true
        api.codigoValido = false
        capturar<ErrorApp.NoAutorizado> { auth.activar("VIEJO123", "7319") }

        assertEquals("Ni token, ni verificador, ni sesión cambiaron", antes, almacen.datos)
        api.conRed = false
        auth.volverAlPin()
        assertFalse("El PIN de antes sigue sirviendo", auth.ingresar("1234").conServidor)
    }

    @Test
    fun `un PIN nuevo que no es de 4 digitos no llega al servidor`() = runTest {
        for (malo in listOf("123", "12345", "123456")) capturar<ErrorApp.Validacion> { auth.activar("ABC123", malo) }
        assertEquals(0, api.activacionesPedidas)
    }
}
