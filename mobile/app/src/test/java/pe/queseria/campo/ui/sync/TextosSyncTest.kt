package pe.queseria.campo.ui.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import pe.queseria.campo.datos.local.EntregaRetenidaFila
import pe.queseria.campo.datos.local.EstadoSync
import pe.queseria.campo.datos.local.ProductorEntidad
import pe.queseria.campo.datos.local.RecoleccionEntidad
import pe.queseria.campo.sync.ResumenSync
import java.time.Instant

/** Lo que B7 le dice al acopiador: cuándo se sincronizó, qué se envió y qué quedó atascado. */
class TextosSyncTest {

    /** 2026-10-15 07:05 en Lima (12:05Z). */
    private val ahora = Instant.parse("2026-10-15T12:05:00Z").toEpochMilli()

    private fun recoleccion(id: String, motivo: String? = null) = RecoleccionEntidad(
        id = id, productorId = 7, productorUuidCliente = null, litros = "10.00", observacion = null,
        registradaEn = "2026-10-15T12:00:00.000Z", latitud = null, longitud = null, precisionM = null,
        origenUbicacion = "ninguna", ubicacionSimulada = false, horaGps = null, horaAutomatica = true,
        hashAnterior = null, firma = "f", productorNombre = "Juana Mamani",
        registradaEnMs = ahora, estadoSync = EstadoSync.RECHAZADO, motivo = motivo,
    )

    private fun retenida(id: String) = EntregaRetenidaFila(
        id = id, litros = "23.50", registradaEnMs = ahora, productor = "Rosa Quispe",
        motivoProductor = "Ya existe un productor con ese documento", productorClave = "u1",
    )

    // ─── Último sync ──────────────────────────────────────────────────────────

    @Test
    fun `sin haber sincronizado nunca se dice asi`() {
        assertEquals("Nunca", TextosSync.textoUltimoSync(null, ahora))
    }

    @Test
    fun `lo reciente se cuenta en minutos`() {
        assertEquals("Hace un momento", TextosSync.textoUltimoSync(ahora - 30_000, ahora))
        assertEquals("Hace 5 min", TextosSync.textoUltimoSync(ahora - 5 * 60_000, ahora))
        assertEquals("Hace 59 min", TextosSync.textoUltimoSync(ahora - 59 * 60_000, ahora))
    }

    @Test
    fun `pasada una hora se da la hora de Lima, y el dia si no es hoy`() {
        assertEquals("Hoy 04:05", TextosSync.textoUltimoSync(ahora - 3 * 3_600_000, ahora))
        assertEquals("Ayer 07:05", TextosSync.textoUltimoSync(ahora - 24 * 3_600_000, ahora))
        assertEquals("lun 12 oct 07:05", TextosSync.textoUltimoSync(ahora - 3 * 24 * 3_600_000, ahora))
    }

    // ─── Resumen del envío ────────────────────────────────────────────────────

    @Test
    fun `sin nada que enviar se dice claro, no se deja en blanco`() {
        assertEquals("No había nada pendiente por enviar", TextosSync.textoResumen(ResumenSync()))
    }

    @Test
    fun `de a uno el resumen va en singular`() {
        assertEquals("1 entrega enviada", TextosSync.textoResumen(ResumenSync(recoleccionesConfirmadas = 1, lotes = 1)))
        assertEquals("1 productor enviado", TextosSync.textoResumen(ResumenSync(productoresEnviados = 1, lotes = 1)))
        assertEquals(
            "1 alta de productor rechazada",
            TextosSync.textoResumen(ResumenSync(productoresRechazados = 1, lotes = 1)),
        )
        assertEquals(
            "1 entrega rechazada",
            TextosSync.textoResumen(ResumenSync(recoleccionesRechazadas = 1, lotes = 1)),
        )
    }

    @Test
    fun `de a varios el resumen va en plural`() {
        assertEquals(
            "2 entregas enviadas · 3 productores enviados · 2 con alerta · " +
                "2 altas de productor rechazadas · 4 entregas rechazadas",
            TextosSync.textoResumen(
                ResumenSync(
                    productoresEnviados = 3, recoleccionesConfirmadas = 2, productoresRechazados = 2,
                    recoleccionesRechazadas = 4, conAlertas = 2, lotes = 1,
                ),
            ),
        )
    }

    /** El caso que salía como "1 productor · 1 rechazada": el único productor fue rechazado. */
    @Test
    fun `un alta rechazada no se lee como productor enviado`() {
        val texto = TextosSync.textoResumen(
            ResumenSync(productoresRechazados = 1, recoleccionesRechazadas = 1, lotes = 1),
        )
        assertEquals("1 alta de productor rechazada · 1 entrega rechazada", texto)
        assertFalse(texto.contains("enviad"))
    }

    @Test
    fun `el resumen solo nombra lo que hubo`() {
        assertEquals(
            "3 entregas enviadas · 1 con alerta",
            TextosSync.textoResumen(ResumenSync(recoleccionesConfirmadas = 3, conAlertas = 1, lotes = 1)),
        )
    }

    // ─── Titular ──────────────────────────────────────────────────────────────

    @Test
    fun `sin pendientes ni rechazos el titular dice todo enviado`() {
        assertEquals(TextosSync.Titular("Todo enviado", TextosSync.Tono.BIEN), TextosSync.titular(0, 0, 0))
    }

    @Test
    fun `con una rechazada no dice todo enviado`() {
        assertEquals(
            TextosSync.Titular("Enviado, con 1 rechazada", TextosSync.Tono.ADVERTENCIA),
            TextosSync.titular(0, 0, 1),
        )
    }

    @Test
    fun `con varias rechazadas va en plural`() {
        assertEquals(
            TextosSync.Titular("Enviado, con 3 rechazadas", TextosSync.Tono.ADVERTENCIA),
            TextosSync.titular(0, 0, 3),
        )
    }

    @Test
    fun `lo pendiente manda sobre lo rechazado`() {
        assertEquals(
            TextosSync.Titular("1 entrega sin enviar", TextosSync.Tono.ERROR),
            TextosSync.titular(1, 0, 2),
        )
        assertEquals(
            TextosSync.Titular("2 entregas y 1 productor sin enviar", TextosSync.Tono.ERROR),
            TextosSync.titular(2, 1, 0),
        )
    }

    // ─── Ya avisé ─────────────────────────────────────────────────────────────

    private fun altaRechazada(clave: String) = ProductorEntidad(
        clave, null, clave, null, "Rosa Quispe", "41234567", null, 3, null, null, false, null,
        EstadoSync.RECHAZADO, "Ya existe un productor con ese documento", ahora,
    )

    @Test
    fun `cada alta rechazada lleva su leche retenida y las sueltas van aparte`() {
        val p = panoramaDePrueba(avisados = emptySet())
        assertEquals(listOf("u1"), p.porAvisar.altas.map { it.productor.clave })
        assertEquals(listOf("aaaa"), p.porAvisar.altas.single().entregas.map { it.id })
        assertEquals(listOf("bbbb"), p.porAvisar.sueltas.map { it.id })
        assertEquals(2, p.porAvisar.total)
        assertEquals(0, p.avisados.total)
    }

    @Test
    fun `lo avisado sale de por avisar pero se conserva con su leche`() {
        val p = panoramaDePrueba(avisados = setOf(TextosSync.avisoDeAlta("u1")))
        assertEquals(1, p.porAvisar.total)
        assertEquals(listOf("bbbb"), p.porAvisar.sueltas.map { it.id })
        assertEquals("la leche sigue a la vista", listOf("aaaa"), p.avisados.altas.single().entregas.map { it.id })
    }

    @Test
    fun `con todo avisado no queda nada por avisar`() {
        val p = panoramaDePrueba(setOf(TextosSync.avisoDeAlta("u1"), TextosSync.avisoDeEntrega("bbbb")))
        assertEquals(0, p.porAvisar.total)
        assertEquals(2, p.avisados.total)
    }

    @Test
    fun `los avisados se guardan una vez cada uno y se leen igual`() {
        val v1 = TextosSync.agregarAvisado(null, "alta:u1")
        val v2 = TextosSync.agregarAvisado(TextosSync.agregarAvisado(v1, "rec:bbbb"), "alta:u1")
        assertEquals(setOf("alta:u1", "rec:bbbb"), TextosSync.leerAvisados(v2))
        assertEquals(emptySet<String>(), TextosSync.leerAvisados(null))
        assertEquals(emptySet<String>(), TextosSync.leerAvisados(""))
    }

    private fun panoramaDePrueba(avisados: Set<String>) = TextosSync.panorama(
        productoresRechazados = listOf(altaRechazada("u1")),
        rechazadas = listOf(
            recoleccion("aaaa", "El productor no está registrado (súbalo antes que sus recolecciones)"),
            recoleccion("bbbb", "Un acopiador solo registra productores de ruta"),
        ),
        retenidas = listOf(retenida("aaaa")),
        avisados = avisados,
    )

    // ─── Rechazadas: las de arrastre van aparte ───────────────────────────────

    @Test
    fun `una entrega retenida no se muestra tambien como rechazada normal`() {
        val rechazadas = listOf(
            recoleccion("aaaa", "El productor no está registrado (súbalo antes que sus recolecciones)"),
            recoleccion("bbbb", "Un acopiador solo registra productores de ruta"),
        )

        val sueltas = TextosSync.partirRechazadas(rechazadas, listOf(retenida("aaaa")))

        assertEquals("solo queda la que no es por arrastre", listOf("bbbb"), sueltas.map { it.id })
    }

    @Test
    fun `sin entregas retenidas las rechazadas se muestran todas`() {
        val rechazadas = listOf(recoleccion("aaaa"), recoleccion("bbbb"))
        assertEquals(rechazadas, TextosSync.partirRechazadas(rechazadas, emptyList()))
    }

    @Test
    fun `la entrega retenida se lee con hora, litros y productor`() {
        assertEquals("07:05 · 23.50 L · Rosa Quispe", TextosSync.textoRetenida(retenida("aaaa")))
    }

    // ─── Pie de versión ───────────────────────────────────────────────────────

    @Test
    fun `la linea de version identifica el APK`() {
        assertEquals(
            "Versión 0.4.0 · build 2 · commit 0e316f0",
            TextosSync.lineaVersion("0.4.0", 2, "0e316f0"),
        )
    }

    @Test
    fun `el mas avisa de un APK armado con cambios sin commitear`() {
        assertEquals(
            "Versión 0.4.0 · build 2 · commit 0e316f0+",
            TextosSync.lineaVersion("0.4.0", 2, "0e316f0+"),
        )
    }
}
