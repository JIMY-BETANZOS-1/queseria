package pe.queseria.campo.ui.sync

import pe.queseria.campo.datos.local.EntregaRetenidaFila
import pe.queseria.campo.datos.local.RecoleccionEntidad
import pe.queseria.campo.sync.ResumenSync
import pe.queseria.campo.ui.dia.LineasMiDia
import java.time.Instant
import java.time.ZoneId

/** Textos de la pantalla de sincronización (B7), sin Android ni Compose para poder probarlos. */
object TextosSync {

    /** Cuándo fue la última sincronización completa, en palabras de campo. */
    fun textoUltimoSync(ms: Long?, ahora: Long): String {
        if (ms == null) return "Nunca"
        val minutos = (ahora - ms) / 60_000
        return when {
            minutos < 1 -> "Hace un momento"
            minutos < 60 -> "Hace $minutos min"
            else -> {
                val hora = LineasMiDia.horaLima(ms)
                val dia = Instant.ofEpochMilli(ms).atZone(LIMA).toLocalDate()
                val hoy = Instant.ofEpochMilli(ahora).atZone(LIMA).toLocalDate()
                when (dia) {
                    hoy -> "Hoy $hora"
                    hoy.minusDays(1) -> "Ayer $hora"
                    else -> "${LineasMiDia.fechaLarga(dia)} $hora"
                }
            }
        }
    }

    /** Qué consiguió la última sincronización manual. */
    fun textoResumen(r: ResumenSync): String {
        val partes = buildList {
            if (r.recoleccionesConfirmadas > 0) {
                add(
                    if (r.recoleccionesConfirmadas == 1) "1 entrega enviada"
                    else "${r.recoleccionesConfirmadas} entregas enviadas",
                )
            }
            if (r.productoresEnviados > 0) {
                add(if (r.productoresEnviados == 1) "1 productor" else "${r.productoresEnviados} productores")
            }
            if (r.conAlertas > 0) add("${r.conAlertas} con alerta")
            if (r.rechazados > 0) {
                add(if (r.rechazados == 1) "1 rechazada" else "${r.rechazados} rechazadas")
            }
        }
        return if (partes.isEmpty()) "No había nada pendiente por enviar" else partes.joinToString(" · ")
    }

    /**
     * Las rechazadas que NO son por arrastre de un alta rechazada: esas tienen su propia sección, con
     * el motivo del productor, y mostrarlas dos veces solo confundiría.
     */
    fun partirRechazadas(
        rechazadas: List<RecoleccionEntidad>,
        retenidas: List<EntregaRetenidaFila>,
    ): List<RecoleccionEntidad> {
        val porArrastre = retenidas.mapTo(HashSet()) { it.id }
        return rechazadas.filterNot { it.id in porArrastre }
    }

    /** "Entrega retenida" tal como se lee en la fila: hora, litros y productor del alta rechazada. */
    fun textoRetenida(r: EntregaRetenidaFila): String =
        "${LineasMiDia.horaLima(r.registradaEnMs)} · ${r.litros} L · ${r.productor}"

    /**
     * Pie de B7: qué APK es exactamente este. El "+" lo pone el build cuando el árbol tenía cambios sin
     * commitear, así que el commit no reproduce lo instalado.
     */
    fun lineaVersion(nombre: String, codigo: Int, commit: String): String =
        "Versión $nombre · build $codigo · commit $commit"

    private val LIMA: ZoneId = ZoneId.of("America/Lima")
}
