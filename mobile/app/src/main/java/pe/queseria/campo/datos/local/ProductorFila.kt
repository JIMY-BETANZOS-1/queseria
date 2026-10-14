package pe.queseria.campo.datos.local

import androidx.room.ColumnInfo

/**
 * Productor como lo ve la pantalla "Mis productores" (B3): sus datos, su ruta, su estado de sanción
 * del pull y lo que ya se le registró hoy en este celular.
 *
 * No es una entidad: es el resultado de [SyncDao.observarProductores].
 */
data class ProductorFila(
    val clave: String,
    @ColumnInfo(name = "servidor_id") val servidorId: Long?,
    @ColumnInfo(name = "uuid_cliente") val uuidCliente: String?,
    val codigo: String?,
    val nombre: String,
    @ColumnInfo(name = "ruta_id") val rutaId: Long?,
    @ColumnInfo(name = "ruta_nombre") val rutaNombre: String?,
    /** false = alta en el campo que el admin aún no aprobó (su pago queda retenido). */
    val aprobado: Boolean,
    @ColumnInfo(name = "estado_sync") val estadoSync: String,
    /** De `estado_productor` (v_productor_estado_hoy). El que no está sancionado no llega en el pull. */
    val sancionado: Boolean,
    val bloqueado: Boolean,
    @ColumnInfo(name = "sancion_hasta") val sancionHasta: String?,
    /** Recolecciones de hoy en este celular (sin contar las rechazadas). */
    @ColumnInfo(name = "n_hoy") val nHoy: Int,
    @ColumnInfo(name = "litros_hoy") val litrosHoy: Double,
)
