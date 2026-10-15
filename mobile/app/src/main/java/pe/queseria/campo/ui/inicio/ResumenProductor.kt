package pe.queseria.campo.ui.inicio

import pe.queseria.campo.datos.local.EstadoSync
import pe.queseria.campo.datos.local.ProductorFila
import java.math.BigDecimal
import java.math.RoundingMode
import java.time.LocalDate
import java.time.format.DateTimeFormatter

/**
 * Textos de cada fila de "Mis productores" (B3). Lógica pura, sin Android, para poder probarla.
 *
 * El estado de sanción viene del pull (`estado_productor` = `v_productor_estado_hoy`, solo
 * productores sancionados hoy): el que no aparece está normal.
 */
object ResumenProductor {

    private val DIA_MES = DateTimeFormatter.ofPattern("dd/MM")

    /** Aviso en rojo de sanción o bloqueo, o null si el productor está normal. */
    fun aviso(fila: ProductorFila): String? {
        val hasta = fechaCorta(fila.sancionHasta)?.let { " hasta $it" } ?: ""
        return when {
            fila.bloqueado -> "BLOQUEADO$hasta"
            fila.sancionado -> "SANCIONADO$hasta"
            else -> null
        }
    }

    /** Nombre en rojo cuando hay sanción o bloqueo (docs/pantallas.md, B3). */
    fun enRojo(fila: ProductorFila): Boolean = fila.bloqueado || fila.sancionado

    /**
     * Lo registrado hoy en este celular: "Pendiente" o "✓ 23.50 L hoy · 2 entregas".
     *
     * Un productor puede entregar varias veces el mismo día (ni `db/schema.sql` ni el contrato lo
     * limitan), así que se muestra el total del día y cuántas entregas lo componen.
     */
    fun estadoDelDia(fila: ProductorFila): String =
        if (fila.nHoy == 0) "Pendiente" else "✓ ${litros(fila.litrosHoy)} L hoy · ${entregas(fila.nHoy)}"

    /** "1 entrega" / "2 entregas". */
    fun entregas(n: Int): String = if (n == 1) "1 entrega" else "$n entregas"

    /** Si ya entregó hoy, se pregunta antes de abrir B4 para que no se registre de más por descuido. */
    fun pideConfirmarOtraEntrega(fila: ProductorFila): Boolean = fila.nHoy > 0

    /** Aviso de B3 antes de la segunda entrega del día. */
    fun textoOtraEntrega(fila: ProductorFila): String =
        "${fila.nombre} ya tiene ${entregas(fila.nHoy)} hoy por ${litros(fila.litrosHoy)} L. " +
            "¿Registrar otra entrega?"

    /** Recordatorio en B4 de lo que ya se le registró hoy, o null si es su primera entrega. */
    fun yaEntregoHoy(fila: ProductorFila): String? =
        if (fila.nHoy == 0) null
        else "Ya registró ${litros(fila.litrosHoy)} L hoy en ${entregas(fila.nHoy)}. Esta es otra entrega."

    /** Alta de campo que el admin aún no aprobó: su leche se recibe, pero el pago queda retenido. */
    fun noAprobado(fila: ProductorFila): Boolean = !fila.aprobado

    /** Alta de campo que todavía no llegó al servidor. */
    fun sinEnviar(fila: ProductorFila): Boolean = fila.estadoSync == EstadoSync.PENDIENTE

    fun litros(valor: Double): String =
        BigDecimal(valor.toString()).setScale(2, RoundingMode.HALF_UP).toPlainString()

    /** "2026-10-21" → "21/10". Devuelve null si no hay fecha o no se entiende. */
    fun fechaCorta(iso: String?): String? {
        if (iso.isNullOrBlank()) return null
        return runCatching { LocalDate.parse(iso.take(10)).format(DIA_MES) }.getOrNull()
    }

    /** Filtro del buscador: por nombre o por código, sin distinguir mayúsculas. */
    fun coincide(fila: ProductorFila, busqueda: String): Boolean {
        val b = busqueda.trim()
        if (b.isEmpty()) return true
        return fila.nombre.contains(b, ignoreCase = true) ||
            fila.codigo?.contains(b, ignoreCase = true) == true
    }
}
