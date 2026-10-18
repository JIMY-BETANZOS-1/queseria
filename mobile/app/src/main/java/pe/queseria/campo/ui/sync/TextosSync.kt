package pe.queseria.campo.ui.sync

import pe.queseria.campo.datos.local.EntregaRetenidaFila
import pe.queseria.campo.datos.local.Meta
import pe.queseria.campo.datos.local.ProductorEntidad
import pe.queseria.campo.datos.local.RecoleccionEntidad
import pe.queseria.campo.sync.ResumenSync
import pe.queseria.campo.ui.componentes.TextosPendientes
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

    enum class Tono { BIEN, ADVERTENCIA, ERROR }

    data class Titular(val texto: String, val tono: Tono)

    /**
     * Titular de B7. Lo rechazado no está pendiente (no se reenvía), pero tampoco está "todo enviado":
     * el acopiador tiene que avisar al administrador. [rechazadas] = rechazos que todavía no avisó.
     */
    fun titular(entregasPendientes: Int, productoresPendientes: Int, rechazadas: Int): Titular {
        TextosPendientes.contar(entregasPendientes, productoresPendientes)?.let {
            return Titular("$it sin enviar", Tono.ERROR)
        }
        return when {
            rechazadas == 1 -> Titular("Enviado, con 1 rechazada", Tono.ADVERTENCIA)
            rechazadas > 1 -> Titular("Enviado, con $rechazadas rechazadas", Tono.ADVERTENCIA)
            else -> Titular("Todo enviado", Tono.BIEN)
        }
    }

    /**
     * Qué consiguió la última sincronización manual. Un alta rechazada nunca se cuenta como productor
     * enviado: cada cosa se nombra con lo que le pasó.
     */
    fun textoResumen(r: ResumenSync): String {
        val partes = buildList {
            if (r.recoleccionesConfirmadas > 0) {
                add(plural(r.recoleccionesConfirmadas, "1 entrega enviada", "entregas enviadas"))
            }
            if (r.productoresEnviados > 0) {
                add(plural(r.productoresEnviados, "1 productor enviado", "productores enviados"))
            }
            if (r.conAlertas > 0) add("${r.conAlertas} con alerta")
            if (r.productoresRechazados > 0) {
                add(plural(r.productoresRechazados, "1 alta de productor rechazada", "altas de productor rechazadas"))
            }
            if (r.recoleccionesRechazadas > 0) {
                add(plural(r.recoleccionesRechazadas, "1 entrega rechazada", "entregas rechazadas"))
            }
        }
        return if (partes.isEmpty()) "No había nada pendiente por enviar" else partes.joinToString(" · ")
    }

    private fun plural(n: Int, uno: String, varios: String) = if (n == 1) uno else "$n $varios"

    // ─── Rechazos y "Ya avisé" ────────────────────────────────────────────────

    /** Un alta rechazada con la leche que se le registró (rechazada por arrastre). */
    data class AltaRechazada(val productor: ProductorEntidad, val entregas: List<EntregaRetenidaFila>)

    data class Rechazos(val altas: List<AltaRechazada>, val sueltas: List<RecoleccionEntidad>) {
        val total: Int get() = altas.size + sueltas.size
    }

    /** Lo que falta avisar al administrador y lo que el acopiador ya marcó como avisado. */
    data class PanoramaRechazos(val porAvisar: Rechazos, val avisados: Rechazos)

    /** Clave en [Meta.AVISOS_VISTOS] de un alta rechazada y de una entrega rechazada suelta. */
    fun avisoDeAlta(clave: String) = "alta:$clave"
    fun avisoDeEntrega(id: String) = "rec:$id"

    /** Valor guardado en Meta → claves avisadas. */
    fun leerAvisados(valor: String?): Set<String> =
        valor?.lineSequence()?.map { it.trim() }?.filter { it.isNotEmpty() }?.toSet() ?: emptySet()

    /** Agrega [clave] al valor guardado. Marcar como avisado no borra ni cambia nada de la leche. */
    fun agregarAvisado(valor: String?, clave: String): String =
        (leerAvisados(valor) + clave).sorted().joinToString("\n")

    /**
     * Agrupa los rechazos de B7: cada alta con sus entregas retenidas, y aparte las entregas rechazadas
     * por un motivo propio; luego separa lo que ya se avisó al administrador.
     */
    fun panorama(
        productoresRechazados: List<ProductorEntidad>,
        rechazadas: List<RecoleccionEntidad>,
        retenidas: List<EntregaRetenidaFila>,
        avisados: Set<String>,
    ): PanoramaRechazos {
        val porAlta = retenidas.groupBy { it.productorClave }
        val altas = productoresRechazados.map { AltaRechazada(it, porAlta[it.clave].orEmpty()) }
        val sueltas = partirRechazadas(rechazadas, retenidas)
        val (altasAvisadas, altasPorAvisar) = altas.partition { avisoDeAlta(it.productor.clave) in avisados }
        val (sueltasAvisadas, sueltasPorAvisar) = sueltas.partition { avisoDeEntrega(it.id) in avisados }
        return PanoramaRechazos(
            porAvisar = Rechazos(altasPorAvisar, sueltasPorAvisar),
            avisados = Rechazos(altasAvisadas, sueltasAvisadas),
        )
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
