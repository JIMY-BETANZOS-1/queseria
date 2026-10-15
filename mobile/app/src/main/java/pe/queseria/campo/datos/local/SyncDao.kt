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

    /** Altas de campo que el servidor rechazó, con su motivo: las muestra B7. */
    @Query("SELECT * FROM productor WHERE estado_sync = 'RECHAZADO' ORDER BY creado_en_ms DESC")
    abstract fun observarProductoresRechazados(): Flow<List<ProductorEntidad>>

    /**
     * Entregas rechazadas por arrastre: su productor también fue rechazado, así que el servidor
     * respondió "El productor no está registrado". Ese motivo engaña (sí se subió, en el mismo lote),
     * por eso se trae el del productor. La leche ya se recibió y no se puede reapuntar a otro productor
     * sin romper la firma, así que B7 la deja a la vista para reportarla (pendiente (H)).
     */
    @Query(
        """
        SELECT rec.id                AS id,
               rec.litros            AS litros,
               rec.registrada_en_ms  AS registrada_en_ms,
               p.nombre              AS productor,
               p.motivo              AS motivo_productor
          FROM recoleccion rec
          JOIN productor p ON p.uuid_cliente = rec.productor_uuid_cliente
         WHERE rec.estado_sync = 'RECHAZADO' AND p.estado_sync = 'RECHAZADO'
         ORDER BY rec.registrada_en_ms DESC
        """,
    )
    abstract fun observarEntregasRetenidas(): Flow<List<EntregaRetenidaFila>>

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

    // ------------------------------------------------------------- mis productores (B3 / B4)
    /**
     * Productores que este celular tiene bajados (el pull ya dejó solo los de sus rutas vigentes) más
     * las altas de campo pendientes, con el estado de sanción y lo registrado hoy.
     * El emparejamiento de las recolecciones va por `servidor_id` o por `uuid_cliente`, porque una
     * alta de campo todavía no tiene id del servidor.
     */
    @Query(
        """
        SELECT p.clave                      AS clave,
               p.servidor_id                AS servidor_id,
               p.uuid_cliente               AS uuid_cliente,
               p.codigo                     AS codigo,
               p.nombre                     AS nombre,
               p.ruta_id                    AS ruta_id,
               r.nombre                     AS ruta_nombre,
               p.aprobado                   AS aprobado,
               p.estado_sync                AS estado_sync,
               COALESCE(e.sancionado, 0)    AS sancionado,
               COALESCE(e.bloqueado, 0)     AS bloqueado,
               e.sancion_hasta              AS sancion_hasta,
               (SELECT COUNT(*) FROM recoleccion rec
                 WHERE rec.estado_sync <> 'RECHAZADO'
                   AND rec.registrada_en_ms >= :desdeMs AND rec.registrada_en_ms < :hastaMs
                   AND ((p.servidor_id  IS NOT NULL AND rec.productor_id = p.servidor_id)
                     OR (p.uuid_cliente IS NOT NULL AND rec.productor_uuid_cliente = p.uuid_cliente))
               )                            AS n_hoy,
               (SELECT COALESCE(SUM(CAST(rec.litros AS REAL)), 0) FROM recoleccion rec
                 WHERE rec.estado_sync <> 'RECHAZADO'
                   AND rec.registrada_en_ms >= :desdeMs AND rec.registrada_en_ms < :hastaMs
                   AND ((p.servidor_id  IS NOT NULL AND rec.productor_id = p.servidor_id)
                     OR (p.uuid_cliente IS NOT NULL AND rec.productor_uuid_cliente = p.uuid_cliente))
               )                            AS litros_hoy
          FROM productor p
          LEFT JOIN ruta             r ON r.id = p.ruta_id
          LEFT JOIN estado_productor e ON e.productor_id = p.servidor_id
         WHERE p.estado_sync <> 'RECHAZADO'
         ORDER BY p.nombre COLLATE NOCASE
        """,
    )
    abstract fun observarProductores(desdeMs: Long, hastaMs: Long): Flow<List<ProductorFila>>

    /** El mismo productor de [observarProductores], para B4: el aviso de bloqueo sigue al pull. */
    @Query(
        """
        SELECT p.clave                      AS clave,
               p.servidor_id                AS servidor_id,
               p.uuid_cliente               AS uuid_cliente,
               p.codigo                     AS codigo,
               p.nombre                     AS nombre,
               p.ruta_id                    AS ruta_id,
               r.nombre                     AS ruta_nombre,
               p.aprobado                   AS aprobado,
               p.estado_sync                AS estado_sync,
               COALESCE(e.sancionado, 0)    AS sancionado,
               COALESCE(e.bloqueado, 0)     AS bloqueado,
               e.sancion_hasta              AS sancion_hasta,
               (SELECT COUNT(*) FROM recoleccion rec
                 WHERE rec.estado_sync <> 'RECHAZADO'
                   AND rec.registrada_en_ms >= :desdeMs AND rec.registrada_en_ms < :hastaMs
                   AND ((p.servidor_id  IS NOT NULL AND rec.productor_id = p.servidor_id)
                     OR (p.uuid_cliente IS NOT NULL AND rec.productor_uuid_cliente = p.uuid_cliente))
               )                            AS n_hoy,
               (SELECT COALESCE(SUM(CAST(rec.litros AS REAL)), 0) FROM recoleccion rec
                 WHERE rec.estado_sync <> 'RECHAZADO'
                   AND rec.registrada_en_ms >= :desdeMs AND rec.registrada_en_ms < :hastaMs
                   AND ((p.servidor_id  IS NOT NULL AND rec.productor_id = p.servidor_id)
                     OR (p.uuid_cliente IS NOT NULL AND rec.productor_uuid_cliente = p.uuid_cliente))
               )                            AS litros_hoy
          FROM productor p
          LEFT JOIN ruta             r ON r.id = p.ruta_id
          LEFT JOIN estado_productor e ON e.productor_id = p.servidor_id
         WHERE p.clave = :clave
        """,
    )
    abstract fun observarProductor(clave: String, desdeMs: Long, hastaMs: Long): Flow<ProductorFila?>

    /**
     * UUID de las recolecciones que este celular ya tiene del día. Sirve para no contar dos veces las
     * que `GET /acopiador/mi-dia` también devuelve al rehidratar B3 en un celular reinstalado: el id de
     * la recolección es el mismo a los dos lados (lo genera el celular).
     */
    @Query(
        """
        SELECT id FROM recoleccion
         WHERE estado_sync <> 'RECHAZADO'
           AND registrada_en_ms >= :desdeMs AND registrada_en_ms < :hastaMs
        """,
    )
    abstract fun observarIdsRecolecciones(desdeMs: Long, hastaMs: Long): Flow<List<String>>

    /** Rutas vigentes del acopiador (las deja el pull). La usa el alta de productor en campo (B5). */
    @Query("SELECT * FROM ruta ORDER BY nombre COLLATE NOCASE")
    abstract fun observarRutas(): Flow<List<RutaEntidad>>

    /**
     * Productores que este celular conoce, para avisar en B5 de un posible duplicado antes de crear
     * otro: el `documento` es UNIQUE en la base, así que repetirlo acaba en un alta rechazada.
     */
    @Query("SELECT * FROM productor WHERE estado_sync <> 'RECHAZADO' ORDER BY nombre COLLATE NOCASE")
    abstract fun observarProductoresLocales(): Flow<List<ProductorEntidad>>

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
