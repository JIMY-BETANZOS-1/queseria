package pe.queseria.campo.datos.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

/** Acceso a Room que usan el registro, el motor de sincronización y "Mi día". */
@Dao
abstract class SyncDao {

    // ------------------------------------------------------------- registro en el campo
    @Insert(onConflict = OnConflictStrategy.ABORT)
    abstract suspend fun insertarRecoleccion(r: RecoleccionEntidad)

    @Insert(onConflict = OnConflictStrategy.ABORT)
    abstract suspend fun insertarProductor(p: ProductorEntidad)

    // ------------------------------------------------------------- cola de envío
    @Query("SELECT * FROM productor WHERE estado_sync = 'PENDIENTE' ORDER BY creado_en_ms LIMIT :limite")
    abstract suspend fun productoresPendientes(limite: Int): List<ProductorEntidad>

    @Query("SELECT * FROM recoleccion WHERE estado_sync = 'PENDIENTE' ORDER BY registrada_en_ms LIMIT :limite")
    abstract suspend fun recoleccionesPendientes(limite: Int): List<RecoleccionEntidad>

    @Query("""UPDATE productor SET estado_sync = 'SINCRONIZADO', motivo = NULL,
              servidor_id = COALESCE(:servidorId, servidor_id), codigo = COALESCE(:codigo, codigo)
              WHERE clave = :clave""")
    abstract suspend fun productorSincronizado(clave: String, servidorId: Long?, codigo: String?)

    @Query("UPDATE productor SET estado_sync = 'RECHAZADO', motivo = :motivo WHERE clave = :clave")
    abstract suspend fun productorRechazado(clave: String, motivo: String?)

    @Query("""UPDATE recoleccion SET estado_sync = 'SINCRONIZADO', alertas = :alertas, motivo = NULL,
              ultimo_error = NULL, sincronizada_en_ms = :ahora WHERE id = :id""")
    abstract suspend fun recoleccionSincronizada(id: String, alertas: String?, ahora: Long)

    @Query("UPDATE recoleccion SET estado_sync = 'RECHAZADO', motivo = :motivo, ultimo_error = NULL WHERE id = :id")
    abstract suspend fun recoleccionRechazada(id: String, motivo: String?)

    /** Falla de red o del servidor: siguen PENDIENTES y se cuenta el intento. (≤ 500 ids por lote) */
    @Query("UPDATE recoleccion SET intentos = intentos + 1, ultimo_error = :error WHERE id IN (:ids)")
    abstract suspend fun sumarIntento(ids: List<String>, error: String?)

    @Query("SELECT COUNT(*) FROM recoleccion WHERE estado_sync = 'PENDIENTE'")
    abstract fun observarPendientes(): Flow<Int>

    @Query("SELECT * FROM recoleccion WHERE estado_sync = 'RECHAZADO' ORDER BY registrada_en_ms DESC")
    abstract fun observarRechazadas(): Flow<List<RecoleccionEntidad>>

    // ------------------------------------------------------------- pull
    @Upsert
    abstract suspend fun upsertRutas(rutas: List<RutaEntidad>)

    @Upsert
    abstract suspend fun upsertProductores(productores: List<ProductorEntidad>)

    @Query("SELECT id FROM ruta")
    abstract suspend fun idsRutas(): List<Long>

    @Query("DELETE FROM ruta WHERE id IN (:ids)")
    abstract suspend fun borrarRutas(ids: List<Long>)

    /** Solo productores ya confirmados por el servidor: las altas de campo pendientes no se tocan. */
    @Query("SELECT servidor_id FROM productor WHERE servidor_id IS NOT NULL AND estado_sync = 'SINCRONIZADO'")
    abstract suspend fun idsProductoresDelServidor(): List<Long>

    @Query("DELETE FROM productor WHERE servidor_id IN (:ids) AND estado_sync = 'SINCRONIZADO'")
    abstract suspend fun borrarProductores(ids: List<Long>)

    @Query("DELETE FROM estado_productor")
    abstract suspend fun borrarEstados()

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun insertarEstados(estados: List<EstadoProductorEntidad>)

    /** Solo se borra lo que el servidor ya confirmó, y pasado un tiempo. */
    @Query("DELETE FROM recoleccion WHERE estado_sync = 'SINCRONIZADO' AND registrada_en_ms < :antesDeMs")
    abstract suspend fun purgarSincronizadas(antesDeMs: Long)

    /** Aplica un pull completo en una sola transacción (upsert + borrar lo que ya no está vigente). */
    @Transaction
    open suspend fun aplicarPull(
        rutas: List<RutaEntidad>,
        rutaIdsVigentes: Set<Long>,
        productores: List<ProductorEntidad>,
        productorIdsVigentes: Set<Long>,
        estados: List<EstadoProductorEntidad>,
        meta: List<MetaEntidad>,
        purgarAntesDeMs: Long,
    ) {
        upsertRutas(rutas)
        idsRutas().filterNot { it in rutaIdsVigentes }.chunked(LOTE_SQL).forEach { borrarRutas(it) }
        upsertProductores(productores)
        idsProductoresDelServidor().filterNot { it in productorIdsVigentes }
            .chunked(LOTE_SQL).forEach { borrarProductores(it) }
        borrarEstados()
        insertarEstados(estados)
        meta.forEach { guardarMeta(it) }
        purgarSincronizadas(purgarAntesDeMs)
    }

    // ------------------------------------------------------------- mi día
    @Query("SELECT * FROM recoleccion WHERE registrada_en_ms >= :desdeMs AND registrada_en_ms < :hastaMs ORDER BY registrada_en_ms")
    abstract suspend fun recoleccionesEntre(desdeMs: Long, hastaMs: Long): List<RecoleccionEntidad>

    // ------------------------------------------------------------- meta
    @Query("SELECT valor FROM meta WHERE clave = :clave")
    abstract suspend fun meta(clave: String): String?

    @Upsert
    abstract suspend fun guardarMeta(m: MetaEntidad)

    @Query("SELECT valor FROM meta WHERE clave = :clave")
    abstract fun observarMeta(clave: String): Flow<String?>

    companion object {
        // SQLite de Android 11 admite como máximo 999 parámetros por consulta
        const val LOTE_SQL = 500
    }
}
