package pe.queseria.campo.datos.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
abstract class AnalistaDao {
    @Upsert
    abstract suspend fun upsertEntregas(entregas: List<EntregaAnalistaEntidad>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun guardarRevision(revision: RevisionCalidadEntidad)

    @Query("SELECT * FROM entrega_analista WHERE registrada_en_ms >= :desdeMs AND registrada_en_ms < :hastaMs ORDER BY registrada_en")
    abstract fun observarEntregas(desdeMs: Long, hastaMs: Long): Flow<List<EntregaAnalistaEntidad>>

    @Query("SELECT * FROM revision_calidad")
    abstract suspend fun revisionesPendientes(): List<RevisionCalidadEntidad>

    @Query("DELETE FROM revision_calidad WHERE recoleccion_id = :id")
    abstract suspend fun borrarRevision(id: String)

    @Query("UPDATE entrega_analista SET estado_calidad = :estado, revisada = 1 WHERE id = :id")
    abstract suspend fun marcarRevisada(id: String, estado: String)

    @Query("""UPDATE entrega_analista SET estado_calidad = :estado, ph = :ph,
              temperatura_c = :temperaturaC, grasa_pct = :grasaPct, densidad = :densidad,
              antibioticos_positivo = :antibioticosPositivo WHERE id = :id""")
    abstract suspend fun guardarResultadoLocal(
        id: String, estado: String, ph: Double?, temperaturaC: Double?,
        grasaPct: Double?, densidad: Double?, antibioticosPositivo: Boolean?,
    )

    @Query("UPDATE entrega_analista SET foto_url = :fotoUrl WHERE id = :id")
    abstract suspend fun guardarFotoUrl(id: String, fotoUrl: String)

    @Transaction
    open suspend fun aplicarPull(entregas: List<EntregaAnalistaEntidad>) {
        upsertEntregas(entregas)
    }
}
