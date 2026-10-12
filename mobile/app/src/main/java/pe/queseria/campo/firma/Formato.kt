package pe.queseria.campo.firma

import java.math.BigDecimal
import java.math.RoundingMode
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

/**
 * Formatos de la cadena canónica v1 (docs/sincronizacion.md, §2).
 *
 * Los valores se formatean UNA vez al registrar, se guardan así en Room y se envían tal cual en el
 * JSON: el servidor vuelve a formatear un número ya redondeado y obtiene el mismo texto.
 */
object Formato {
    private val HORA_UTC = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

    /** Redondeo half-up (lejos del cero, como ROUND_HALF_UP de Python) y punto decimal. */
    fun decimal(valor: BigDecimal, decimales: Int): String =
        valor.setScale(decimales, RoundingMode.HALF_UP).toPlainString()

    fun litros(valor: BigDecimal): String = decimal(valor, 2)

    // Double.toString da el decimal más corto que representa al double (sin ruido binario)
    fun coordenada(valor: Double): String = decimal(BigDecimal(valor.toString()), 6)

    fun precision(valor: Float): String = decimal(BigDecimal(valor.toString()), 1)

    /** UTC con milisegundos truncados: 2026-10-10T07:05:09.120Z */
    fun hora(instante: Instant): String = HORA_UTC.format(instante.truncatedTo(ChronoUnit.MILLIS))
}
