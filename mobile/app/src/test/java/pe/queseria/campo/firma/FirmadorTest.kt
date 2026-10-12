package pe.queseria.campo.firma

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import pe.queseria.campo.datos.remoto.Red
import pe.queseria.campo.registro.ArmadoRecoleccion
import pe.queseria.campo.registro.LecturaUbicacion
import pe.queseria.campo.registro.NuevaRecoleccion
import java.math.BigDecimal
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec
import java.time.Instant
import java.util.Base64

class FirmadorTest {

    /** Mismo ejemplo que backend/tests/test_sync_push.py::test_cadena_canonica_documentada y docs/sincronizacion.md */
    private val cadenaDocumentada =
        "v1|0b6f1c9e-3a52-4c1e-9d0a-5c3f6b2a7e11|id:42|23.50|2026-10-10T07:05:09.120Z|-15.614512|-69.972310|8.5" +
            "|gps|false||true|412e239b417a846a962cd5f1298859f8a08f3c43828820b957d8c62204ed9030|"

    /**
     * Vector de interoperabilidad: firma hecha en Python con la librería del backend (cryptography) y una
     * clave DESECHABLE (solo para esta prueba), verificada además con app.firma.verificar del backend.
     */
    private val clavePublicaPython =
        "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE+KvgojaHBnSC3uEm4kTzLWbNPiUdiZtNM9sdpFFE2PKuWBrDy/QYhPjT+FfylqS03HSfAmfABFLHTy9yGQrZMA=="
    private val firmaPython =
        "MEUCIHOKqzvnlkocABCdktUxs7i8pyX6xOSQ53d73X3+yP6SAiEAyWIzVgc42P5u5FNKoOjHIGedCmmhiHyKapNSiUFaAZE="
    private val hashDeFirmaPython = "7ec181f0d9b5a130e25300270bc78d515498e6e760c21264ef9a0d8ac710506e"

    private val ejemplo = NuevaRecoleccion(
        productorId = 42, productorUuidCliente = null, productorNombre = "Juana",
        litros = BigDecimal("23.5"), observacion = "Tarro azul",
        ubicacion = LecturaUbicacion(latitud = -15.6145123, longitud = -69.97231, precisionM = 8.46f,
                                     simulada = false, horaGps = null),
        horaAutomatica = true,
    )
    private val ahora = Instant.parse("2026-10-10T07:05:09.120456Z")
    private val idEjemplo = "0b6f1c9e-3a52-4c1e-9d0a-5c3f6b2a7e11"

    private fun nuevaClave() = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()

    @Test
    fun `arma la cadena documentada desde los datos crudos`() {
        var firmada: String? = null
        ArmadoRecoleccion.armar(ejemplo, idEjemplo.uppercase(), ahora, firmaAnterior = null) { firmada = it; "x" }
        assertEquals(cadenaDocumentada, firmada)
    }

    @Test
    fun `una firma hecha en Python con el backend valida en Kotlin`() {
        val clave = KeyFactory.getInstance("EC")
            .generatePublic(X509EncodedKeySpec(Base64.getDecoder().decode(clavePublicaPython)))
        assertTrue(Firmador.verificar(clave, cadenaDocumentada, firmaPython))
        assertFalse(Firmador.verificar(clave, cadenaDocumentada.replace("23.50", "23.51"), firmaPython))
        assertEquals(hashDeFirmaPython, Firmador.hashAnterior(firmaPython))
    }

    @Test
    fun `la firma generada valida con la clave publica y detecta cambios`() {
        val par = nuevaClave()
        val r = ArmadoRecoleccion.armar(ejemplo, idEjemplo, ahora, null) { Firmador.firmar(par.private, it) }
        val cadena = Firmador.cadenaV1(ArmadoRecoleccion.datosFirmados(r))
        assertEquals(cadenaDocumentada, cadena)
        assertFalse(r.firma.contains("\n"))

        // Lo que el servidor recibe: la clave pública SPKI DER en base64
        val publica = KeyFactory.getInstance("EC")
            .generatePublic(X509EncodedKeySpec(Base64.getDecoder().decode(Firmador.clavePublicaB64(par.public))))
        assertTrue(Firmador.verificar(publica, cadena, r.firma))
        assertFalse(Firmador.verificar(publica, cadena.replace("|id:42|", "|id:43|"), r.firma))
        assertFalse(Firmador.verificar(nuevaClave().public, cadena, r.firma))
        assertFalse(Firmador.verificar(publica, cadena, "no es base64"))
    }

    @Test
    fun `hash_anterior encadena con el SHA-256 de la firma previa`() {
        val par = nuevaClave()
        val primera = ArmadoRecoleccion.armar(ejemplo, idEjemplo, ahora, null) { Firmador.firmar(par.private, it) }
        val segunda = ArmadoRecoleccion.armar(ejemplo, "7a21aaaa-0000-4000-8000-000000000001", ahora, primera.firma) {
            Firmador.firmar(par.private, it)
        }
        assertNull(primera.hashAnterior)
        assertEquals(Firmador.sha256Hex(primera.firma.toByteArray(Charsets.US_ASCII)), segunda.hashAnterior)
        assertTrue(Firmador.cadenaV1(ArmadoRecoleccion.datosFirmados(segunda)).endsWith("|${segunda.hashAnterior}"))
        assertNull(Firmador.hashAnterior(""))
    }

    @Test
    fun `sin GPS se firma con campos vacios y origen ninguna`() {
        val sinGps = ejemplo.copy(ubicacion = null, observacion = "", productorId = null,
                                  productorUuidCliente = "8F0C0000-AAAA-4BBB-8CCC-000000000001")
        var cadena = ""
        val r = ArmadoRecoleccion.armar(sinGps, idEjemplo, ahora, null) { cadena = it; "x" }
        assertEquals(
            "v1|$idEjemplo|uuid:8f0c0000-aaaa-4bbb-8ccc-000000000001|23.50|2026-10-10T07:05:09.120Z" +
                "||||ninguna|false||true||", cadena)
        assertEquals("ninguna", r.origenUbicacion)
        assertNull(r.observacion)
        assertNull(r.productorId)
    }

    @Test
    fun `redondeo half-up igual que Python y horas en UTC con milisegundos`() {
        assertEquals("0.13", Formato.litros(BigDecimal("0.125")))
        assertEquals("-0.13", Formato.decimal(BigDecimal("-0.125"), 2))
        assertEquals("1000.00", Formato.litros(BigDecimal("1000")))
        assertEquals("-15.614513", Formato.coordenada(-15.6145125))
        assertEquals("-69.972310", Formato.coordenada(-69.97231))
        assertEquals("8.5", Formato.precision(8.46f))
        assertEquals("0.1", Formato.precision(0.05f))
        assertEquals("2026-10-10T12:05:09.999Z", Formato.hora(java.time.OffsetDateTime.parse("2026-10-10T07:05:09.999999-05:00").toInstant()))
    }

    @Test
    fun `la observacion se firma exacta sin recortar espacios`() {
        val conEspacios = Firmador.cadenaV1(ArmadoRecoleccion.datosFirmados(
            ArmadoRecoleccion.armar(ejemplo.copy(observacion = " Tarro azul "), idEjemplo, ahora, null) { "x" }))
        assertFalse(conEspacios == cadenaDocumentada)
        assertTrue(conEspacios.contains(Firmador.sha256Hex(" Tarro azul ".toByteArray())))
    }

    @Test
    fun `el JSON envia exactamente los numeros firmados`() {
        val r = ArmadoRecoleccion.armar(ejemplo.copy(litros = BigDecimal("20")), idEjemplo, ahora, null) { "firma" }
        val json = Red.json.encodeToString(pe.queseria.campo.datos.remoto.RecoleccionPushDto.serializer(), ArmadoRecoleccion.aDto(r))
        assertTrue(json, json.contains("\"litros\":20.00"))
        assertTrue(json, json.contains("\"latitud\":-15.614512"))
        assertTrue(json, json.contains("\"longitud\":-69.972310"))
        assertTrue(json, json.contains("\"precision_m\":8.5"))
        assertTrue(json, json.contains("\"registrada_en\":\"2026-10-10T07:05:09.120Z\""))
        assertTrue(json, json.contains("\"productor_uuid_cliente\":null"))
    }
}
