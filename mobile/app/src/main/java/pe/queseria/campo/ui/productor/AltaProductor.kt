package pe.queseria.campo.ui.productor

import pe.queseria.campo.datos.local.ProductorEntidad
import java.text.Normalizer

/**
 * Un productor que ya está en este celular y se parece al que se está dando de alta.
 *
 * [porDocumento] = coincide el DNI/RUC, que en la base es UNIQUE: crear otro acaba seguro en rechazo,
 * así que la pantalla invierte los botones y propone usar el que ya existe.
 */
data class Duplicado(val productor: ProductorEntidad, val porDocumento: Boolean)

/**
 * Reglas del alta de productor en el campo (B5), sin Android ni Compose para poder probarlas.
 *
 * El contrato (docs/sincronizacion.md) solo exige `nombre` y `ruta_id` al acopiador: el `tipo`
 * (`de_ruta`) lo fija la API por el rol y el "no aprobado" lo pone un trigger de la base. `documento` y
 * `celular` son opcionales, pero si se envían tienen que cumplir los CHECK de `productor`, así que se
 * validan aquí antes de guardar: un alta que el servidor va a rechazar deja la leche del productor con
 * el pago retenido (ver el pendiente (H) de docs/sincronizacion.md).
 */
object AltaProductor {

    /** Primer problema que impide guardar, en el orden de los campos de la pantalla; null si está bien. */
    fun validar(nombre: String, documento: String?, celular: String?, rutaId: Long?): String? = when {
        nombre.isBlank() -> "Escriba el nombre del productor"
        !documento.isNullOrBlank() && !PATRON_DOCUMENTO.matches(documento.trim()) ->
            "El DNI debe tener 8 dígitos (o 11 si es RUC)"
        !celular.isNullOrBlank() && !PATRON_CELULAR.matches(celular.trim()) ->
            "El celular debe tener 9 dígitos"
        rutaId == null -> "Elija la ruta"
        else -> null
    }

    /**
     * Busca entre los productores del celular uno que sea probablemente el mismo. El DNI manda sobre el
     * nombre: los homónimos son normales en la zona, un DNI repetido no.
     */
    fun posibleDuplicado(nombre: String, documento: String?, existentes: List<ProductorEntidad>): Duplicado? {
        val doc = documento?.trim()?.takeIf { it.isNotEmpty() }
        if (doc != null) {
            existentes.firstOrNull { it.documento?.trim() == doc }
                ?.let { return Duplicado(it, porDocumento = true) }
        }
        val buscado = normalizar(nombre)
        if (buscado.isEmpty()) return null
        return existentes.firstOrNull { normalizar(it.nombre) == buscado }
            ?.let { Duplicado(it, porDocumento = false) }
    }

    fun textoDuplicado(d: Duplicado): String {
        val quien = listOfNotNull(d.productor.nombre, d.productor.codigo).joinToString(" · ")
        return if (d.porDocumento) {
            "Ese DNI ya es de $quien. Si crea otro productor, el servidor lo rechazará."
        } else {
            "Ya hay un productor con ese nombre: $quien. ¿Es el mismo?"
        }
    }

    /** Minúsculas, sin tildes y con los espacios colapsados: "José  MAMANI" y "jose mamani" son iguales. */
    fun normalizar(texto: String): String =
        Normalizer.normalize(texto.trim().lowercase(), Normalizer.Form.NFD)
            .replace(TILDES, "")
            .replace(ESPACIOS, " ")

    // Los mismos CHECK que ck_productor_documento y ck_productor_celular en db/schema.sql
    private val PATRON_DOCUMENTO = Regex("^[0-9]{8}([0-9]{3})?$")
    private val PATRON_CELULAR = Regex("^[0-9]{9}$")
    private val TILDES = Regex("\\p{Mn}+")
    private val ESPACIOS = Regex("\\s+")
}
