package pe.queseria.campo.ui.analista

import pe.queseria.campo.datos.local.EstadoReporte
import pe.queseria.campo.datos.local.ReporteAnalistaEntidad
import pe.queseria.campo.ui.productor.AltaProductor
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID

/**
 * Reglas del reporte del analista (sin Android ni Compose para poder probarlas). El reporte es informativo:
 * comentario, foto o ambos; no lleva valores de calidad ni genera sanciones.
 */
object Reportes {
    const val MAX_COMENTARIO = 500

    /** Primer problema que impide guardar; null si se puede guardar. */
    fun validar(comentario: String, fotoRuta: String?): String? = when {
        comentario.isBlank() && fotoRuta == null -> "Escriba un comentario o tome una foto"
        comentario.trim().length > MAX_COMENTARIO -> "El comentario puede tener hasta $MAX_COMENTARIO letras"
        else -> null
    }

    /**
     * Con foto queda PENDIENTE de envío (la foto es lo que guarda el servidor). Solo comentario: SOLO_CELULAR,
     * porque la base todavía no tiene dónde guardarlo (docs/sincronizacion.md §5b).
     */
    fun nuevo(productorClave: String, productorNombre: String, comentario: String, fotoRuta: String?,
              ahoraMs: Long, id: String = UUID.randomUUID().toString()): ReporteAnalistaEntidad =
        ReporteAnalistaEntidad(
            id = id, productorClave = productorClave, productorNombre = productorNombre,
            comentario = comentario.trim().takeIf { it.isNotEmpty() }, fotoRuta = fotoRuta, creadoEnMs = ahoraMs,
            estado = if (fotoRuta != null) EstadoReporte.PENDIENTE else EstadoReporte.SOLO_CELULAR,
            motivo = null, intentos = 0, enviadoEnMs = null,
        )

    /** Texto del estado para la lista del productor. */
    fun textoEstado(r: ReporteAnalistaEntidad): String = when (r.estado) {
        EstadoReporte.ENVIADO -> "Foto enviada"
        EstadoReporte.PENDIENTE -> "Foto por enviar" + (r.motivo?.let { " · $it" } ?: "")
        EstadoReporte.SOLO_CELULAR -> "Solo en este celular (el servidor aún no guarda comentarios)"
        EstadoReporte.RECHAZADO -> "No se pudo enviar" + (r.motivo?.let { ": $it" } ?: "")
        else -> r.estado
    }

    private val FECHA_HORA = DateTimeFormatter.ofPattern("dd/MM HH:mm")

    fun fechaHora(ms: Long, zona: ZoneId = ZoneId.of("America/Lima")): String =
        FECHA_HORA.format(Instant.ofEpochMilli(ms).atZone(zona))

    /** Alta de externo desde el celular del analista: nombre o empresa, DNI (o RUC) y celular, todos obligatorios. */
    fun validarExterno(nombre: String, documento: String, celular: String): String? = when {
        nombre.isBlank() -> "Escriba el nombre o la empresa"
        documento.isBlank() -> "Escriba el DNI (o el RUC si es empresa)"
        celular.isBlank() -> "Escriba el celular"
        // Mismos CHECK que la base (ck_productor_documento, ck_productor_celular); el externo exige ambos
        else -> AltaProductor.validar(nombre, documento, celular, rutaId = 0L)
    }

    /** Filtro de la lista: por nombre (sin tildes), código o DNI. */
    fun coincide(termino: String, nombre: String, codigo: String?, documento: String?): Boolean {
        val t = AltaProductor.normalizar(termino)
        if (t.isEmpty()) return true
        return AltaProductor.normalizar(nombre).contains(t)
            || codigo?.lowercase()?.contains(t) == true
            || documento?.contains(t) == true
    }
}
