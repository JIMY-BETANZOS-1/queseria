package pe.queseria.campo.seguridad

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import pe.queseria.campo.datos.remoto.ActivarDto
import pe.queseria.campo.datos.remoto.ApiQueseria
import pe.queseria.campo.datos.remoto.CambiarPinDto
import pe.queseria.campo.datos.remoto.ErrorApp
import pe.queseria.campo.datos.remoto.LoginPinDto
import pe.queseria.campo.datos.remoto.TokenMovilDto
import pe.queseria.campo.datos.remoto.llamar
import pe.queseria.campo.datos.remoto.traducirHttp
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID

data class UsuarioLocal(val id: Long, val rol: String, val nombre: String)

sealed class EstadoSesion {
    /** El celular aún no se vinculó con un código del admin. */
    data object SinVincular : EstadoSesion()

    /** Vinculado; falta ingresar el PIN. */
    data class Cerrada(val usuario: UsuarioLocal) : EstadoSesion()

    /** conServidor = el PIN lo validó el servidor (hay token nuevo); false = validado sin red. */
    data class Abierta(val usuario: UsuarioLocal, val debeCambiarPin: Boolean, val conServidor: Boolean) : EstadoSesion()
}

/**
 * Vinculación del celular, ingreso con PIN y token de la API.
 *
 * Flujo (backend/app/routers/auth.py):
 *  1. activar(código del admin, 24 h): crea la clave de firma en el Keystore y envía su clave pública
 *     + device_uuid. El PIN inicial lo define el admin al crear el usuario.
 *  2. ingresar(PIN): con red manda el servidor; sin red se valida con [PinLocal].
 *  3. Si el servidor responde debe_cambiar_pin, la app pide cambiarlo (cambiarPin).
 */
class Autenticador(
    private val api: ApiQueseria?,
    private val almacen: AlmacenClaves,
    private val clavePublica: () -> String,
    private val pin: PinLocal,
    private val modelo: String?,
    private val reloj: () -> Long = System::currentTimeMillis,
) {
    private val _estado = MutableStateFlow(usuario()?.let { EstadoSesion.Cerrada(it) } ?: EstadoSesion.SinVincular)
    val estado: StateFlow<EstadoSesion> = _estado.asStateFlow()

    private fun api(): ApiQueseria =
        api ?: throw ErrorApp.Local("Falta configurar la URL del servidor (api.base.url en local.properties)")

    /** Identificador de este celular para el servidor (se crea una vez). */
    fun deviceUuid(): String =
        almacen.leer(K_DEVICE) ?: UUID.randomUUID().toString().also { almacen.guardar(K_DEVICE, it) }

    fun usuario(): UsuarioLocal? {
        val id = almacen.leer(K_USUARIO_ID)?.toLongOrNull() ?: return null
        return UsuarioLocal(id, almacen.leer(K_ROL) ?: "", almacen.leer(K_NOMBRE) ?: "")
    }

    suspend fun activar(codigo: String): UsuarioLocal {
        val r = llamar { api().activar(ActivarDto(codigo.trim(), deviceUuid(), clavePublica(), modelo)) }
        val u = UsuarioLocal(r.usuario.id, r.usuario.rol, r.usuario.nombreCompleto)
        if (usuario()?.id != u.id) pin.borrar()
        guardarUsuario(u)
        almacen.guardar(K_DISPOSITIVO_ID, r.dispositivoId.toString())
        borrarToken()
        _estado.value = EstadoSesion.Cerrada(u)
        return u
    }

    suspend fun ingresar(pinTexto: String): EstadoSesion.Abierta {
        validarPin(pinTexto)
        val u = usuario() ?: throw ErrorApp.Local("Primero vincule el celular con el código del administrador")
        pin.bloqueadoHasta()?.let { throw bloqueado(it) }

        try {
            val t = llamar { api().loginPin(LoginPinDto(deviceUuid(), pinTexto)) }
            guardarToken(t)
            pin.guardar(pinTexto)
            return abrir(UsuarioLocal(t.usuario.id, t.usuario.rol, t.usuario.nombreCompleto), conServidor = true)
        } catch (e: ErrorApp.DispositivoNoVinculado) {
            // El celular fue desvinculado: no es fallo de PIN, no acumular intentos
            throw e
        } catch (e: ErrorApp.NoAutorizado) {
            pin.registrarFallo()
            throw e
        } catch (e: ErrorApp.PinBloqueado) {
            pin.bloquear()
            throw e
        } catch (e: ErrorApp) {
            if (!e.esTransitorio) throw e
        }

        // Sin red (o el servidor no responde): verificador local
        return when (val r = pin.verificar(pinTexto)) {
            ResultadoPin.Correcto -> abrir(u, conServidor = false)
            is ResultadoPin.Incorrecto -> throw ErrorApp.NoAutorizado("PIN incorrecto. Le quedan ${r.quedan} intentos")
            is ResultadoPin.Bloqueado -> throw bloqueado(r.hastaMs)
            ResultadoPin.SinVerificador -> throw ErrorApp.Local("La primera vez necesita señal para ingresar con su PIN")
        }
    }

    suspend fun cambiarPin(actual: String, nuevo: String) {
        validarPin(actual)
        validarPin(nuevo)
        val r = llamar { api().cambiarPin(bearer(), CambiarPinDto(actual, nuevo)) }
        if (!r.isSuccessful) {
            val error = traducirHttp(r.code(), r.errorBody()?.string())
            if (error is ErrorApp.PinBloqueado) pin.bloquear()
            throw error
        }
        pin.guardar(nuevo)
        almacen.guardar(K_DEBE_CAMBIAR, null)
        (estado.value as? EstadoSesion.Abierta)?.let { _estado.value = it.copy(debeCambiarPin = false) }
    }

    fun cerrarSesion() {
        // El token se conserva: la sincronización en segundo plano sigue con la sesión cerrada
        usuario()?.let { _estado.value = EstadoSesion.Cerrada(it) }
    }

    fun tokenVigente(): String? {
        val expira = almacen.leer(K_TOKEN_EXPIRA)?.toLongOrNull() ?: return null
        return almacen.leer(K_TOKEN)?.takeIf { expira > reloj() }
    }

    /** Cabecera Authorization; si el token venció hay que ingresar con PIN y señal. */
    fun bearer(): String = tokenVigente()?.let { "Bearer $it" }
        ?: throw ErrorApp.NoAutorizado("Sesión vencida: ingrese con su PIN (con señal) para sincronizar")

    /** El servidor rechazó el token (401): vencido, celular o usuario desactivado. */
    fun invalidarToken() = borrarToken()

    /** Momento hasta el que el PIN está bloqueado en este celular; null si no está bloqueado. */
    fun bloqueadoHasta(): Long? = pin.bloqueadoHasta()

    // -------------------------------------------------------------
    private fun abrir(u: UsuarioLocal, conServidor: Boolean): EstadoSesion.Abierta {
        guardarUsuario(u)
        val abierta = EstadoSesion.Abierta(u, almacen.leer(K_DEBE_CAMBIAR) == "1", conServidor)
        _estado.value = abierta
        return abierta
    }

    private fun guardarUsuario(u: UsuarioLocal) {
        almacen.guardar(K_USUARIO_ID, u.id.toString())
        almacen.guardar(K_ROL, u.rol)
        almacen.guardar(K_NOMBRE, u.nombre)
    }

    private fun guardarToken(t: TokenMovilDto) {
        almacen.guardar(K_TOKEN, t.accessToken)
        // Un minuto de margen para no usar un token a punto de vencer
        almacen.guardar(K_TOKEN_EXPIRA, (reloj() + (t.expiraEnMin - 1) * 60_000L).toString())
        almacen.guardar(K_DISPOSITIVO_ID, t.dispositivoId.toString())
        almacen.guardar(K_DEBE_CAMBIAR, if (t.debeCambiarPin) "1" else null)
    }

    private fun borrarToken() {
        almacen.guardar(K_TOKEN, null)
        almacen.guardar(K_TOKEN_EXPIRA, null)
    }

    private fun bloqueado(hastaMs: Long) = ErrorApp.PinBloqueado(
        "Demasiados intentos. PIN bloqueado hasta las " +
            HORA.format(Instant.ofEpochMilli(hastaMs).atZone(LIMA))
    )

    private fun validarPin(p: String) {
        if (!PATRON_PIN.matches(p)) throw ErrorApp.Validacion("El PIN debe tener de 4 a 6 dígitos")
    }

    private companion object {
        val PATRON_PIN = Regex("^[0-9]{4,6}$")   // igual que PATRON_PIN del backend
        val LIMA: ZoneId = ZoneId.of("America/Lima")
        val HORA: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")
        const val K_DEVICE = "device_uuid"
        const val K_USUARIO_ID = "usuario_id"
        const val K_ROL = "usuario_rol"
        const val K_NOMBRE = "usuario_nombre"
        const val K_DISPOSITIVO_ID = "dispositivo_id"
        const val K_TOKEN = "token"
        const val K_TOKEN_EXPIRA = "token_expira_ms"
        const val K_DEBE_CAMBIAR = "debe_cambiar_pin"
    }
}
