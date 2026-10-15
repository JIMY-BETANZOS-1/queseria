package pe.queseria.campo.ui.inicio

import pe.queseria.campo.datos.local.ProductorFila
import pe.queseria.campo.datos.remoto.RecoleccionMiDiaDto

/** Una recolección de hoy según el servidor (`GET /acopiador/mi-dia`). */
data class EntregaServidor(
    /** El mismo UUID que generó el celular que la registró. */
    val id: String,
    val productorId: Long,
    val litros: Double,
    val anulada: Boolean,
) {
    companion object {
        fun de(dto: RecoleccionMiDiaDto) = EntregaServidor(
            id = dto.recoleccionId,
            productorId = dto.productorId,
            litros = dto.litros,
            anulada = dto.anuladaEn != null,
        )
    }
}

/**
 * Rehidratación del estado del día en B3 (lógica pura, sin Android).
 *
 * El total del día de cada productor sale de Room, así que un celular reinstalado o revinculado
 * muestra "Pendiente" para productores que sí entregaron hoy. `GET /acopiador/mi-dia` devuelve esas
 * recolecciones (ver `docs/sincronizacion.md`, observación 10) y aquí se suman a las filas.
 *
 * Lo que NO se puede rehidratar: lo que registró otro acopiador (mi-día filtra por `registrado_por`)
 * y lo de días anteriores.
 */
object RehidratarDia {

    /**
     * Suma a cada fila las recolecciones que el servidor tiene hoy y este celular no.
     *
     * [idsLocales] evita contar dos veces: una recolección registrada en este celular y ya
     * sincronizada está en Room **y** en la respuesta del servidor. Las anuladas no suman (el
     * servidor tampoco las cuenta).
     */
    fun fusionar(
        filas: List<ProductorFila>,
        delServidor: List<EntregaServidor>,
        idsLocales: Set<String>,
    ): List<ProductorFila> {
        if (delServidor.isEmpty()) return filas
        val locales = idsLocales.mapTo(HashSet()) { it.lowercase() }
        val faltantes = delServidor
            .filter { !it.anulada && it.id.lowercase() !in locales }
            .groupBy { it.productorId }
        if (faltantes.isEmpty()) return filas
        return filas.map { fila ->
            val extras = fila.servidorId?.let { faltantes[it] } ?: return@map fila
            fila.copy(
                nHoy = fila.nHoy + extras.size,
                litrosHoy = fila.litrosHoy + extras.sumOf { it.litros },
            )
        }
    }
}
