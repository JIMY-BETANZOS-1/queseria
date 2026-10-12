package pe.queseria.campo.seguridad

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

sealed class ResultadoPin {
    data object Correcto : ResultadoPin()
    data class Incorrecto(val quedan: Int) : ResultadoPin()
    data class Bloqueado(val hastaMs: Long) : ResultadoPin()
    data object SinVerificador : ResultadoPin()
}

/**
 * Verificación del PIN SIN red (decisión del cliente, ver "Observaciones" en docs/sincronizacion.md).
 *
 * Con red manda el servidor (POST /auth/pin/login). Tras cada ingreso exitoso en el servidor se guarda
 * aquí un hash PBKDF2 del PIN, cifrado en la [CajaFuerte]; sin red se valida contra él.
 * Bloqueo local: [MAX_INTENTOS] fallos → [BLOQUEO_MS] sin poder ingresar (los valores por defecto del
 * backend PIN_MAX_INTENTOS / PIN_BLOQUEO_MIN, que la API no expone).
 */
class PinLocal(private val almacen: AlmacenClaves, private val reloj: () -> Long = System::currentTimeMillis) {

    fun tieneVerificador(): Boolean = almacen.leer(VERIFICADOR) != null

    /** Guarda el PIN que el servidor acaba de aceptar y reinicia los fallos. */
    fun guardar(pin: String) {
        val sal = ByteArray(16).also { SecureRandom().nextBytes(it) }
        almacen.guardar(VERIFICADOR, "$ITERACIONES:${b64(sal)}:${b64(derivar(pin, sal, ITERACIONES))}")
        reiniciar()
    }

    fun bloqueadoHasta(): Long? = almacen.leer(BLOQUEADO_HASTA)?.toLongOrNull()?.takeIf { it > reloj() }

    fun verificar(pin: String): ResultadoPin {
        bloqueadoHasta()?.let { return ResultadoPin.Bloqueado(it) }
        val partes = almacen.leer(VERIFICADOR)?.split(":") ?: return ResultadoPin.SinVerificador
        val (iteraciones, sal, hash) = Triple(partes[0].toInt(), d64(partes[1]), d64(partes[2]))
        return if (MessageDigest.isEqual(derivar(pin, sal, iteraciones), hash)) {
            reiniciar()
            ResultadoPin.Correcto
        } else {
            registrarFallo()
        }
    }

    /** Suma un fallo; al llegar al máximo bloquea y reinicia el contador (igual que el servidor). */
    fun registrarFallo(): ResultadoPin {
        val fallos = (almacen.leer(FALLOS)?.toIntOrNull() ?: 0) + 1
        if (fallos >= MAX_INTENTOS) {
            bloquear()
            return ResultadoPin.Bloqueado(reloj() + BLOQUEO_MS)
        }
        almacen.guardar(FALLOS, fallos.toString())
        return ResultadoPin.Incorrecto(MAX_INTENTOS - fallos)
    }

    fun bloquear() {
        almacen.guardar(FALLOS, null)
        almacen.guardar(BLOQUEADO_HASTA, (reloj() + BLOQUEO_MS).toString())
    }

    fun reiniciar() {
        almacen.guardar(FALLOS, null)
        almacen.guardar(BLOQUEADO_HASTA, null)
    }

    fun borrar() {
        almacen.guardar(VERIFICADOR, null)
        reiniciar()
    }

    private fun derivar(pin: String, sal: ByteArray, iteraciones: Int): ByteArray =
        SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
            .generateSecret(PBEKeySpec(pin.toCharArray(), sal, iteraciones, 256))
            .encoded

    private fun b64(b: ByteArray) = Base64.getEncoder().encodeToString(b)
    private fun d64(s: String) = Base64.getDecoder().decode(s)

    companion object {
        const val MAX_INTENTOS = 5
        const val BLOQUEO_MS = 15 * 60 * 1000L
        // PBKDF2 en un celular de gama baja: ~0.2–0.4 s por intento
        const val ITERACIONES = 20_000
        private const val VERIFICADOR = "pin_verificador"
        private const val FALLOS = "pin_fallos"
        private const val BLOQUEADO_HASTA = "pin_bloqueado_hasta"
    }
}
