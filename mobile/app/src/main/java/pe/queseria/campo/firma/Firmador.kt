package pe.queseria.campo.firma

import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.security.Signature
import java.util.Base64

/**
 * Datos de una recolección tal como se firman y se envían (textos ya formateados con [Formato]).
 * Debe ir productorId o productorUuidCliente, nunca ambos.
 */
data class DatosFirmados(
    val id: String,
    val productorId: Long?,
    val productorUuidCliente: String?,
    val litros: String,
    val registradaEn: String,
    val latitud: String?,
    val longitud: String?,
    val precisionM: String?,
    val origenUbicacion: String?,
    val ubicacionSimulada: Boolean,
    val horaGps: String?,
    val horaAutomatica: Boolean?,
    val observacion: String?,
    val hashAnterior: String?,
)

/** Cadena canónica v1 y firma ECDSA P-256 + SHA-256 (contrato: docs/sincronizacion.md, §2). */
object Firmador {
    const val VERSION = "v1"
    private const val ALGORITMO = "SHA256withECDSA"

    fun cadenaV1(d: DatosFirmados): String {
        require((d.productorId == null) != (d.productorUuidCliente == null)) {
            "Indique productorId o productorUuidCliente (solo uno)"
        }
        val productor = if (d.productorId != null) "id:${d.productorId}" else "uuid:${d.productorUuidCliente!!.lowercase()}"
        // Observación: SHA-256 del texto exacto (sin recortar espacios); vacía o nula = cadena vacía
        val observacion = d.observacion?.takeIf { it.isNotEmpty() }?.let { sha256Hex(it.toByteArray(Charsets.UTF_8)) }
        return listOf(
            VERSION,
            d.id.lowercase(),
            productor,
            d.litros,
            d.registradaEn,
            d.latitud,
            d.longitud,
            d.precisionM,
            d.origenUbicacion,
            if (d.ubicacionSimulada) "true" else "false",
            d.horaGps,
            d.horaAutomatica?.let { if (it) "true" else "false" },
            observacion,
            d.hashAnterior,
        ).joinToString("|") { it ?: "" }
    }

    /** Firma DER en base64 estándar sin saltos de línea. */
    fun firmar(clave: PrivateKey, cadena: String): String {
        val firma = Signature.getInstance(ALGORITMO).run {
            initSign(clave)
            update(cadena.toByteArray(Charsets.UTF_8))
            sign()
        }
        return Base64.getEncoder().encodeToString(firma)
    }

    fun verificar(clave: PublicKey, cadena: String, firmaB64: String): Boolean = try {
        Signature.getInstance(ALGORITMO).run {
            initVerify(clave)
            update(cadena.toByteArray(Charsets.UTF_8))
            verify(Base64.getDecoder().decode(firmaB64))
        }
    } catch (e: IllegalArgumentException) {
        false
    }

    /** hash_anterior del registro siguiente: SHA-256 hex del texto base64 de la firma previa (ASCII). */
    fun hashAnterior(firmaAnterior: String?): String? =
        firmaAnterior?.takeIf { it.isNotEmpty() }?.let { sha256Hex(it.toByteArray(Charsets.US_ASCII)) }

    /** Clave pública X.509 SubjectPublicKeyInfo (DER) en base64 estándar, como la espera /auth/dispositivo/activar. */
    fun clavePublicaB64(clave: PublicKey): String = Base64.getEncoder().encodeToString(clave.encoded)

    fun sha256Hex(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
}
