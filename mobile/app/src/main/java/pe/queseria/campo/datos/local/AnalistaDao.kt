package pe.queseria.campo.datos.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

/** Reportes del analista y su lista de productores (los productores y rutas los baja el pull, en [SyncDao]). */
@Dao
abstract class AnalistaDao {
    @Insert
    abstract suspend fun insertarReporte(r: ReporteAnalistaEntidad)

    @Query("SELECT * FROM reporte_analista WHERE estado = 'PENDIENTE' ORDER BY creado_en_ms")
    abstract suspend fun reportesPorEnviar(): List<ReporteAnalistaEntidad>

    @Query("UPDATE reporte_analista SET estado = 'ENVIADO', motivo = NULL, enviado_en_ms = :ahora WHERE id = :id")
    abstract suspend fun reporteEnviado(id: String, ahora: Long)

    @Query("UPDATE reporte_analista SET estado = 'RECHAZADO', motivo = :motivo WHERE id = :id")
    abstract suspend fun reporteRechazado(id: String, motivo: String?)

    /** Sigue PENDIENTE: se cuenta el intento y se muestra el motivo (sin señal, sin entrega aún...). */
    @Query("UPDATE reporte_analista SET intentos = intentos + 1, motivo = :motivo WHERE id = :id")
    abstract suspend fun reporteReintentar(id: String, motivo: String?)

    @Query("SELECT * FROM reporte_analista WHERE productor_clave = :clave ORDER BY creado_en_ms DESC")
    abstract fun observarReportes(clave: String): Flow<List<ReporteAnalistaEntidad>>

    @Query("SELECT COUNT(*) FROM reporte_analista WHERE estado = 'PENDIENTE'")
    abstract fun observarPorEnviar(): Flow<Int>

    /** Productores de todas las rutas y externos (estos al final), sin los rechazados por el servidor. */
    @Query(
        """
        SELECT p.clave, p.servidor_id, p.codigo, p.nombre, p.documento, r.nombre AS ruta_nombre, p.aprobado,
               p.estado_sync, p.motivo,
               COALESCE(e.sancionado, 0) AS sancionado, COALESCE(e.bloqueado, 0) AS bloqueado,
               (SELECT COUNT(*) FROM reporte_analista x WHERE x.productor_clave = p.clave) AS n_reportes,
               (SELECT COUNT(*) FROM reporte_analista x WHERE x.productor_clave = p.clave
                                                          AND x.estado = 'PENDIENTE') AS n_por_enviar
          FROM productor p
          LEFT JOIN ruta r ON r.id = p.ruta_id
          LEFT JOIN estado_productor e ON e.productor_id = p.servidor_id
         WHERE p.estado_sync <> 'RECHAZADO'
         ORDER BY p.ruta_id IS NULL, r.nombre COLLATE NOCASE, p.nombre COLLATE NOCASE
        """,
    )
    abstract fun observarProductores(): Flow<List<ProductorAnalistaFila>>

    @Query("SELECT * FROM productor WHERE clave = :clave")
    abstract suspend fun productor(clave: String): ProductorEntidad?

    /** Altas de externos que el servidor rechazó (DNI repetido...), para avisar en la lista. */
    @Query("SELECT * FROM productor WHERE estado_sync = 'RECHAZADO' ORDER BY creado_en_ms DESC")
    abstract fun observarAltasRechazadas(): Flow<List<ProductorEntidad>>
}
