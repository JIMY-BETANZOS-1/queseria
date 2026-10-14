package pe.queseria.campo.registro

import java.math.BigDecimal

/**
 * Litros tecleados en B4 con el teclado propio de la app (lógica pura, sin Android).
 *
 * Tope de la interfaz: 4 enteros y 2 decimales (un tarro no pasa de unos cientos de litros; la base
 * admite `numeric(8,2)`). Guardar exige un valor mayor que cero, el mismo CHECK que
 * `recoleccion_litros_check` en `db/schema.sql`.
 */
object EntradaLitros {
    const val MAX_ENTEROS = 4
    const val MAX_DECIMALES = 2

    private val PATRON = Regex("""^\d{1,$MAX_ENTEROS}(\.\d{0,$MAX_DECIMALES})?$""")

    fun agregarDigito(actual: String, digito: Char): String {
        if (digito !in '0'..'9') return actual
        val punto = actual.indexOf('.')
        return when {
            // Parte decimal: solo hasta MAX_DECIMALES
            punto >= 0 -> if (actual.length - punto - 1 < MAX_DECIMALES) actual + digito else actual
            // Un cero solo no se acumula: "0" + "5" = "5", "0" + "0" = "0"
            actual == "0" -> if (digito == '0') actual else digito.toString()
            actual.length < MAX_ENTEROS -> actual + digito
            else -> actual
        }
    }

    fun agregarPunto(actual: String): String = when {
        actual.contains('.') -> actual
        actual.isEmpty() -> "0."
        else -> "$actual."
    }

    fun borrar(actual: String): String = actual.dropLast(1)

    /** Los litros a registrar, o null si lo tecleado todavía no sirve (vacío, "0", "0." …). */
    fun valor(texto: String): BigDecimal? {
        if (!PATRON.matches(texto)) return null
        val v = texto.trimEnd('.').toBigDecimalOrNull() ?: return null
        return v.takeIf { it.signum() > 0 }
    }

    /** Lo que se muestra en el visor mientras se teclea. */
    fun paraMostrar(texto: String): String = texto.ifEmpty { "0" }
}
