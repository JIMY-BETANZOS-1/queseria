package pe.queseria.campo.datos.remoto

import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import retrofit2.HttpException
import java.io.IOException

/** Errores que la app muestra al usuario, siempre en español. */
sealed class ErrorApp(mensaje: String) : Exception(mensaje) {
    /** Sin señal o el servidor no responde: se reintenta más tarde. */
    class SinRed : ErrorApp("Sin conexión con el servidor")

    /** 401 `pin_incorrecto`: el PIN no coincide; cuenta como intento fallido en el bloqueo local. */
    class NoAutorizado(mensaje: String) : ErrorApp(mensaje)

    /** 401 `dispositivo_no_vinculado`: el celular fue desactivado o nunca vinculado; no es fallo de PIN. */
    class DispositivoNoVinculado(mensaje: String) : ErrorApp(mensaje)

    /** 403: el rol no puede hacer esta operación. */
    class Prohibido(mensaje: String) : ErrorApp(mensaje)

    /** 409: la base rechazó la operación (regla de negocio o registro ya existente). */
    class Conflicto(mensaje: String) : ErrorApp(mensaje)

    /** 422: datos inválidos. */
    class Validacion(mensaje: String) : ErrorApp(mensaje)

    /** 423: PIN bloqueado por intentos fallidos (en el servidor o en el celular). */
    class PinBloqueado(mensaje: String) : ErrorApp(mensaje)

    /** 429: demasiados códigos de activación incorrectos. */
    class DemasiadosIntentos(mensaje: String) : ErrorApp(mensaje)

    /** 5xx u otra respuesta inesperada: se reintenta más tarde. */
    class Servidor(val http: Int?, mensaje: String) : ErrorApp(mensaje)

    /** Error del celular (falta configuración, primera vez sin red...). */
    class Local(mensaje: String) : ErrorApp(mensaje)

    /** Conviene reintentar sin intervención del usuario. */
    val esTransitorio: Boolean get() = this is SinRed || this is Servidor
}

private val jsonError = Json { ignoreUnknownKeys = true }

/** Ejecuta una llamada a la API y traduce cualquier falla a [ErrorApp]. */
suspend fun <T> llamar(bloque: suspend () -> T): T = try {
    bloque()
} catch (e: ErrorApp) {
    throw e
} catch (e: HttpException) {
    throw traducirHttp(e.code(), e.response()?.errorBody()?.string())
} catch (e: IOException) {
    throw ErrorApp.SinRed()
} catch (e: SerializationException) {
    throw ErrorApp.Servidor(null, "Respuesta inesperada del servidor")
}

fun traducirHttp(codigo: Int, cuerpo: String?): ErrorApp {
    val errorBody = cuerpo?.let {
        try { jsonError.decodeFromString(ErrorCuerpo.serializer(), it) } catch (e: Exception) { null }
    }
    val mensaje = errorBody?.mensaje
    val codigoError = errorBody?.codigo
    return when (codigo) {
        401 -> when (codigoError) {
            "dispositivo_no_vinculado" ->
                ErrorApp.DispositivoNoVinculado(mensaje ?: "Este celular no está vinculado o fue desactivado")
            else -> ErrorApp.NoAutorizado(mensaje ?: "Debe ingresar con su PIN")
        }
        403 -> ErrorApp.Prohibido(mensaje ?: "No tiene permiso para esta operación")
        409 -> ErrorApp.Conflicto(mensaje ?: "La operación no se pudo realizar")
        422 -> ErrorApp.Validacion(mensaje ?: "Datos inválidos")
        423 -> ErrorApp.PinBloqueado(mensaje ?: "PIN bloqueado por intentos fallidos")
        429 -> ErrorApp.DemasiadosIntentos(mensaje ?: "Demasiados intentos. Intente en unos minutos")
        else -> ErrorApp.Servidor(codigo, mensaje ?: "El servidor tuvo un problema ($codigo). Se reintentará")
    }
}
