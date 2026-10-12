package pe.queseria.campo.seguridad

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Almacén clave → texto. Interfaz para poder probar la lógica sin Android. */
interface AlmacenClaves {
    fun leer(clave: String): String?
    fun guardar(clave: String, valor: String?)
}

/**
 * Valores sensibles (token, datos de sesión, verificador del PIN) cifrados con AES-256-GCM.
 *
 * La clave AES vive en Android Keystore (no exportable) y el texto cifrado (iv + datos, en base64)
 * en SharedPreferences privadas, excluidas de las copias de seguridad.
 *
 * No se usa EncryptedSharedPreferences: androidx.security:security-crypto quedó deprecada y además
 * trae Tink, pesado para un celular con poca RAM. Esto hace lo mismo con la API estándar.
 */
class CajaFuerte(context: Context) : AlmacenClaves {
    private val prefs = context.getSharedPreferences("caja_fuerte", Context.MODE_PRIVATE)
    private val clave: SecretKey by lazy { obtenerOCrearClave() }

    @Synchronized
    override fun leer(clave: String): String? {
        val cifrado = prefs.getString(clave, null) ?: return null
        return try {
            descifrar(cifrado)
        } catch (e: Exception) {
            // Clave del Keystore perdida o dato dañado: se trata como ausente
            null
        }
    }

    @Synchronized
    override fun guardar(clave: String, valor: String?) {
        prefs.edit().apply {
            if (valor == null) remove(clave) else putString(clave, cifrar(valor))
        }.commit()
    }

    private fun cifrar(texto: String): String {
        val cipher = Cipher.getInstance(TRANSFORMACION).apply { init(Cipher.ENCRYPT_MODE, clave) }
        val datos = cipher.doFinal(texto.toByteArray(Charsets.UTF_8))
        return Base64.getEncoder().encodeToString(cipher.iv + datos)
    }

    private fun descifrar(texto: String): String {
        val bytes = Base64.getDecoder().decode(texto)
        val cipher = Cipher.getInstance(TRANSFORMACION).apply {
            init(Cipher.DECRYPT_MODE, clave, GCMParameterSpec(128, bytes, 0, IV_BYTES))
        }
        return String(cipher.doFinal(bytes, IV_BYTES, bytes.size - IV_BYTES), Charsets.UTF_8)
    }

    private fun obtenerOCrearClave(): SecretKey {
        val ks = KeyStore.getInstance(PROVEEDOR).apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build()
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVEEDOR)
            .apply { init(spec) }
            .generateKey()
    }

    private companion object {
        const val PROVEEDOR = "AndroidKeyStore"
        const val ALIAS = "queseria_caja_v1"
        const val TRANSFORMACION = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
    }
}
