package pe.queseria.campo.ui.sync

import org.junit.Assert.assertEquals
import org.junit.Test
import pe.queseria.campo.datos.local.EntregaRetenidaFila
import pe.queseria.campo.datos.local.EstadoSync
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
        motivoProductor = "Ya existe un productor con ese documento",
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
    fun `el resumen solo nombra lo que hubo`() {
        assertEquals(
            "3 entregas enviadas · 1 con alerta",
            TextosSync.textoResumen(ResumenSync(recoleccionesConfirmadas = 3, conAlertas = 1, lotes = 1)),
        )
        assertEquals(
            "2 entregas enviadas · 1 productor · 1 rechazada",
            TextosSync.textoResumen(
                ResumenSync(productoresEnviados = 1, recoleccionesConfirmadas = 2, rechazados = 1, lotes = 1),
            ),
        )
    }

    @Test
    fun `de a uno el resumen va en singular`() {
        assertEquals(
            "1 entrega enviada",
            TextosSync.textoResumen(ResumenSync(recoleccionesConfirmadas = 1, lotes = 1)),
        )
        assertEquals(
            "1 productor",
            TextosSync.textoResumen(ResumenSync(productoresEnviados = 1, lotes = 1)),
        )
        assertEquals("1 rechazada", TextosSync.textoResumen(ResumenSync(rechazados = 1, lotes = 1)))
    }

    @Test
    fun `de a varios el resumen va en plural`() {
        assertEquals(
            "2 entregas enviadas · 3 productores · 2 con alerta · 4 rechazadas",
            TextosSync.textoResumen(
                ResumenSync(
                    productoresEnviados = 3, recoleccionesConfirmadas = 2, rechazados = 4,
                    conAlertas = 2, lotes = 1,
                ),
            ),
        )
    }

    @Test
    fun `sin nada que enviar se dice claro, no se deja en blanco`() {
        assertEquals("No había nada pendiente por enviar", TextosSync.textoResumen(ResumenSync()))
    }

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
