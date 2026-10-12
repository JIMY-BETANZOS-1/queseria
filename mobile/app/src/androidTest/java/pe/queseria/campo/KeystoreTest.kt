package pe.queseria.campo

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import pe.queseria.campo.firma.ClaveDispositivo
import pe.queseria.campo.firma.Firmador
import pe.queseria.campo.seguridad.CajaFuerte
import java.security.KeyFactory
import java.security.KeyStore
import java.security.interfaces.ECPublicKey
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

/** Android Keystore real: firma ECDSA P-256 que valida con la clave pública que se envía al servidor. */
@RunWith(AndroidJUnit4::class)
class KeystoreTest {
    private val alias = "prueba_firma"
    private val clave = ClaveDispositivo(alias)

    @After
    fun limpiar() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(alias)

    @Test
    fun firmaConElKeystoreYValidaConLaClavePublica() {
        val publica = clave.obtenerOCrear()
        assertEquals("se reutiliza la misma clave", publica, clave.obtenerOCrear())
        assertEquals(256, (publica as ECPublicKey).params.order.bitLength())

        val cadena = "v1|0b6f1c9e-3a52-4c1e-9d0a-5c3f6b2a7e11|id:42|23.50|2026-10-10T07:05:09.120Z|-15.614512" +
            "|-69.972310|8.5|gps|false||true|412e239b417a846a962cd5f1298859f8a08f3c43828820b957d8c62204ed9030|"
        val firma = Firmador.firmar(clave.privada(), cadena)

        // Como lo haría el servidor: reconstruir la clave desde el base64 SPKI DER enviado al activar
        val reconstruida = KeyFactory.getInstance("EC")
            .generatePublic(X509EncodedKeySpec(Base64.getDecoder().decode(Firmador.clavePublicaB64(publica))))
        assertTrue(Firmador.verificar(reconstruida, cadena, firma))
        assertFalse(Firmador.verificar(reconstruida, cadena + "x", firma))
    }

    @Test
    fun cajaFuerteCifraYDescifra() {
        val caja = CajaFuerte(InstrumentationRegistry.getInstrumentation().targetContext)
        caja.guardar("prueba", "token-secreto")
        assertEquals("token-secreto", caja.leer("prueba"))
        caja.guardar("prueba", null)
        assertNull(caja.leer("prueba"))
    }
}
