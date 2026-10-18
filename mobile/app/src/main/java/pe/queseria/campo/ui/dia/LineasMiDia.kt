package pe.queseria.campo.ui.dia

import pe.queseria.campo.datos.local.RecoleccionEntidad
import pe.queseria.campo.datos.remoto.RecoleccionMiDiaDto
import pe.queseria.campo.sync.ResumenMiDia
import java.math.BigDecimal
import java.math.RoundingMode
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId

/**
 * Una entrega del día como la lee el acopiador.
 *
 * [problema] = pintar en rojo (anulada o rechazada). [suma] = cuenta en el total del día; las anuladas
 * y las rechazadas no, igual que en el servidor.
 */
data class LineaDia(
    val id: String,
    val hora: String,
    val productor: String,
    val litros: String,
    val etiqueta: String?,
    val problema: Boolean,
    val suma: Boolean,
)

/**
 * Textos de "Mi día" (B6), sin Android ni Compose para poder probarlos.
 *
 * Las filas del servidor y las locales no se solapan: `MiDia.obtener()` solo deja en `pendientes` y
 * `rechazadas` lo que el servidor todavía no conoce, así que no hay que deduplicar por UUID.
 */
object LineasMiDia {

    /** "mié 15 oct", en hora de Lima. A mano y no con el Locale, que cambia entre versiones de Android. */
    fun fechaLarga(fecha: LocalDate): String =
        "${DIAS[fecha.dayOfWeek.value - 1]} ${fecha.dayOfMonth} ${MESES[fecha.monthValue - 1]}"

    /**
     * "123.50 L · 8 entregas" (el total ya lo calcula MiDia: servidor sin anuladas + lo pendiente).
     * Un día anterior sin red no tiene total: se dice "Sin conexión" en vez de inventarlo.
     */
    fun total(r: ResumenMiDia): String {
        if (r.sinTotal) return "Sin conexión"
        val entregas = if (r.nRecolecciones == 1) "1 entrega" else "${r.nRecolecciones} entregas"
        return "${r.totalLitros.setScale(2, RoundingMode.HALF_UP)} L · $entregas"
    }

    /** "Incluye 2 sin enviar" bajo el total; `null` si no hay total o no falta enviar nada. */
    fun incluyeSinEnviar(r: ResumenMiDia): String? =
        if (r.sinTotal || r.pendientes.isEmpty()) null else "Incluye ${r.pendientes.size} sin enviar"

    /** Texto de la lista vacía, según sea hoy, un día anterior con red o uno sin red. */
    fun sinEntregas(r: ResumenMiDia, esHoy: Boolean): String = when {
        esHoy -> "Todavía no hay entregas registradas hoy."
        r.sinTotal -> "Este celular no tiene nada pendiente de ese día."
        else -> "No hubo entregas ese día."
    }

    fun lineas(r: ResumenMiDia): List<LineaDia> {
        val delServidor = r.servidor?.recolecciones?.map(::deServidor) ?: emptyList()
        val pendientes = r.pendientes.map { deLocal(it, "Sin enviar", problema = false, suma = true) }
        val rechazadas = r.rechazadas.map {
            deLocal(it, "Rechazada: ${it.motivo ?: "sin motivo"}", problema = true, suma = false)
        }
        return (delServidor + pendientes + rechazadas).sortedBy { it.hora }
    }

    private fun deServidor(d: RecoleccionMiDiaDto): LineaDia {
        val anulada = d.anuladaEn != null
        return LineaDia(
            id = d.recoleccionId,
            hora = hora(instante(d.registradaEn)),
            productor = d.productor,
            litros = litros(BigDecimal(d.litros.toString())),
            etiqueta = when {
                anulada -> "Anulada"
                d.estadoCalidad == "alterado" -> "Alterada"
                else -> null
            },
            problema = anulada,
            suma = !anulada,
        )
    }

    private fun deLocal(r: RecoleccionEntidad, etiqueta: String, problema: Boolean, suma: Boolean) = LineaDia(
        id = r.id,
        hora = horaLima(r.registradaEnMs),
        productor = r.productorNombre,
        litros = litros(BigDecimal(r.litros)),
        etiqueta = etiqueta,
        problema = problema,
        suma = suma,
    )

    private fun litros(v: BigDecimal): String = v.setScale(2, RoundingMode.HALF_UP).toPlainString()

    /** "07:05" en hora de Lima. La reusa B7 para las entregas retenidas. */
    fun horaLima(ms: Long): String = hora(Instant.ofEpochMilli(ms))

    private fun hora(i: Instant?): String = i?.atZone(LIMA)
        ?.let { "%02d:%02d".format(it.hour, it.minute) }
        ?: "--:--"

    /** El servidor manda ISO 8601 con zona; si algún día manda otra cosa, la fila se muestra igual. */
    private fun instante(iso: String): Instant? = try {
        OffsetDateTime.parse(iso).toInstant()
    } catch (e: Exception) {
        null
    }

    private val LIMA: ZoneId = ZoneId.of("America/Lima")
    private val DIAS = listOf("lun", "mar", "mié", "jue", "vie", "sáb", "dom")
    private val MESES = listOf(
        "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic",
    )
}
