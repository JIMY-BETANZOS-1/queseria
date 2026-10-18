package pe.queseria.campo.seguridad

/**
 * Reglas del PIN (lógica pura, sin Android). Copia de `seguridad.pin_trivial` del backend: aquí solo
 * sirven para avisar antes de enviar; el que decide es el servidor (422 `pin_trivial`).
 *
 * El PIN es de exactamente [LARGO] dígitos. Se rechazan como triviales 204 de las 10 000 combinaciones
 * (todos iguales, secuencias de subida o bajada, XYXY y XXYY) y los últimos 4 dígitos del DNI o del
 * celular del propio usuario. Se aplica al CREAR el PIN, nunca al ingresar.
 */
object ReglasPin {

    const val LARGO = 4

    fun formatoValido(pin: String): Boolean = pin.length == LARGO && pin.all { it in '0'..'9' }

    /** Por qué el PIN es demasiado obvio, o null si se acepta (mismos textos que el backend). */
    fun trivial(pin: String, dni: String? = null, celular: String? = null): String? {
        require(formatoValido(pin)) { "El PIN debe tener $LARGO dígitos" }
        val (a, b, c, d) = pin.toList()
        val pasos = pin.zipWithNext { x, y -> y - x }.toSet()
        return when {
            a == b && b == c && c == d -> "todos los dígitos son iguales"
            pasos == setOf(1) || pasos == setOf(-1) -> "es una secuencia"
            a == c && b == d -> "repite un par de dígitos"
            a == b && c == d -> "repite dígitos de a dos"
            dni != null && dni.takeLast(LARGO) == pin -> "son los últimos dígitos de su DNI"
            celular != null && celular.takeLast(LARGO) == pin -> "son los últimos dígitos de su celular"
            else -> null
        }
    }
}
