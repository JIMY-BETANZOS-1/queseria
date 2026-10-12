package pe.queseria.campo.firma

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.PublicKey
import java.security.spec.ECGenParameterSpec

/**
 * Clave ECDSA P-256 del celular en Android Keystore: no exportable y atada a este equipo.
 * Se crea una sola vez; si el celular se vuelve a vincular se reutiliza (las recolecciones
 * pendientes firmadas con ella siguen siendo válidas).
 */
class ClaveDispositivo(private val alias: String = "queseria_firma_v1") {

    private fun almacen(): KeyStore = KeyStore.getInstance(PROVEEDOR).apply { load(null) }

    fun existe(): Boolean = almacen().containsAlias(alias)

    /** Devuelve la clave pública (la crea si aún no existe). */
    fun obtenerOCrear(): PublicKey {
        almacen().getCertificate(alias)?.let { return it.publicKey }
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                generar(strongBox = true)
            } catch (e: StrongBoxUnavailableException) {
                generar(strongBox = false)
            }
        } else {
            generar(strongBox = false)
        }
    }

    fun privada(): PrivateKey =
        almacen().getKey(alias, null) as? PrivateKey
            ?: throw IllegalStateException("El celular no tiene clave de firma: vincúlelo de nuevo")

    private fun generar(strongBox: Boolean): PublicKey {
        val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .apply { if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) setIsStrongBoxBacked(true) }
            .build()
        return KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, PROVEEDOR)
            .apply { initialize(spec) }
            .generateKeyPair()
            .public
    }

    private companion object {
        const val PROVEEDOR = "AndroidKeyStore"
    }
}
