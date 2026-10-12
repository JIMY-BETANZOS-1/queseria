package pe.queseria.campo.datos.local

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/** Estado de sincronización de cada ítem local (la "cola" son las filas en PENDIENTE). */
object EstadoSync {
    const val PENDIENTE = "PENDIENTE"       // aún no confirmado por el servidor: se (re)envía
    const val SINCRONIZADO = "SINCRONIZADO" // el servidor respondió creado o duplicado
    const val RECHAZADO = "RECHAZADO"       // el servidor lo rechazó: se conserva con su motivo
}

/**
 * Productor de las rutas del acopiador (bajado del servidor) o dado de alta en el campo.
 * clave = uuid_cliente si lo tiene; si no, "id:<id del servidor>". Así un productor creado en el
 * campo y el mismo productor bajado luego por el pull caen en la misma fila.
 */
@Entity(tableName = "productor", indices = [Index(value = ["servidor_id"], unique = true), Index("ruta_id")])
data class ProductorEntidad(
    @PrimaryKey val clave: String,
    @ColumnInfo(name = "servidor_id") val servidorId: Long?,
    @ColumnInfo(name = "uuid_cliente") val uuidCliente: String?,
    val codigo: String?,
    val nombre: String,
    val documento: String?,
    val celular: String?,
    @ColumnInfo(name = "ruta_id") val rutaId: Long?,
    @ColumnInfo(name = "latitud_ref") val latitudRef: Double?,
    @ColumnInfo(name = "longitud_ref") val longitudRef: Double?,
    val aprobado: Boolean,
    @ColumnInfo(name = "actualizado_en") val actualizadoEn: String?,
    @ColumnInfo(name = "estado_sync") val estadoSync: String,
    val motivo: String?,
    @ColumnInfo(name = "creado_en_ms") val creadoEnMs: Long,
) {
    companion object {
        fun claveDe(servidorId: Long?, uuidCliente: String?): String =
            uuidCliente?.lowercase() ?: "id:${requireNotNull(servidorId)}"
    }
}

@Entity(tableName = "ruta")
data class RutaEntidad(
    @PrimaryKey val id: Long,
    val nombre: String,
    val descripcion: String?,
    @ColumnInfo(name = "actualizado_en") val actualizadoEn: String,
)

/** Fila de v_productor_estado_hoy (solo productores con sanción hoy). Se reemplaza completa en cada pull. */
@Entity(tableName = "estado_productor")
data class EstadoProductorEntidad(
    @PrimaryKey @ColumnInfo(name = "productor_id") val productorId: Long,
    val sancionado: Boolean,
    val bloqueado: Boolean,
    @ColumnInfo(name = "sancion_hasta") val sancionHasta: String?,
)

/**
 * Recolección registrada en el celular. Los campos firmados se guardan como TEXTO ya formateado y
 * no se modifican nunca: se envían tal cual (ver Firmador / docs/sincronizacion.md §2).
 */
@Entity(
    tableName = "recoleccion",
    indices = [Index("estado_sync"), Index("registrada_en_ms")],
)
data class RecoleccionEntidad(
    @PrimaryKey val id: String,
    // --- firmado
    @ColumnInfo(name = "productor_id") val productorId: Long?,
    @ColumnInfo(name = "productor_uuid_cliente") val productorUuidCliente: String?,
    val litros: String,
    val observacion: String?,
    @ColumnInfo(name = "registrada_en") val registradaEn: String,
    val latitud: String?,
    val longitud: String?,
    @ColumnInfo(name = "precision_m") val precisionM: String?,
    @ColumnInfo(name = "origen_ubicacion") val origenUbicacion: String,
    @ColumnInfo(name = "ubicacion_simulada") val ubicacionSimulada: Boolean,
    @ColumnInfo(name = "hora_gps") val horaGps: String?,
    @ColumnInfo(name = "hora_automatica") val horaAutomatica: Boolean,
    @ColumnInfo(name = "hash_anterior") val hashAnterior: String?,
    val firma: String,
    // --- solo local
    @ColumnInfo(name = "productor_nombre") val productorNombre: String,
    @ColumnInfo(name = "registrada_en_ms") val registradaEnMs: Long,
    @ColumnInfo(name = "estado_sync") val estadoSync: String = EstadoSync.PENDIENTE,
    val motivo: String? = null,
    /** Alertas que la base creó (separadas por coma), para mostrarlas. */
    val alertas: String? = null,
    val intentos: Int = 0,
    @ColumnInfo(name = "ultimo_error") val ultimoError: String? = null,
    @ColumnInfo(name = "sincronizada_en_ms") val sincronizadaEnMs: Long? = null,
)

/** Pares clave → valor: cursor del pull, último sync, última firma (cadena hash_anterior), precios. */
@Entity(tableName = "meta")
data class MetaEntidad(@PrimaryKey val clave: String, val valor: String?)

object Meta {
    const val CURSOR_PULL = "cursor_pull"           // siguiente_desde del último pull
    const val ULTIMO_SYNC_MS = "ultimo_sync_ms"
    const val ULTIMO_ERROR_SYNC = "ultimo_error_sync"
    const val ULTIMA_FIRMA = "ultima_firma"         // firma de la última recolección de este celular
    const val PRECIOS = "precios"                   // JSON de PreciosDto
}
