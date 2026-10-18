package pe.queseria.campo.datos.local

import androidx.room.ColumnInfo

/**
 * Entrega que el servidor rechazó porque el alta de su productor también fue rechazada.
 *
 * Su leche ya se recibió y no se puede reasignar sin romper la firma (pendiente (H) de
 * docs/sincronizacion.md), así que B7 la deja a la vista con lo necesario para reportarla.
 * No es una entidad: es el resultado de [SyncDao.observarEntregasRetenidas].
 */
data class EntregaRetenidaFila(
    val id: String,
    val litros: String,
    @ColumnInfo(name = "registrada_en_ms") val registradaEnMs: Long,
    /** El nombre que el acopiador escribió en el alta; el productor nunca llegó a existir. */
    val productor: String,
    @ColumnInfo(name = "motivo_productor") val motivoProductor: String?,
    /** Para mostrarla dentro de la tarjeta de su alta rechazada en B7. */
    @ColumnInfo(name = "productor_clave") val productorClave: String,
)
