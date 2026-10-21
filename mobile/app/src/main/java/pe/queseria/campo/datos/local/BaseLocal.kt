package pe.queseria.campo.datos.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

/**
 * Base local del celular. Sin fallbackToDestructiveMigration: un cambio de versión NUNCA debe borrar
 * recolecciones sin sincronizar (cada cambio de esquema lleva su Migration).
 */
@Database(
    entities = [ProductorEntidad::class, RutaEntidad::class, EstadoProductorEntidad::class,
                RecoleccionEntidad::class, EntregaAnalistaEntidad::class, RevisionCalidadEntidad::class,
                MetaEntidad::class],
    version = 2,
    exportSchema = true,
)
abstract class BaseLocal : RoomDatabase() {
    abstract fun syncDao(): SyncDao
    abstract fun analistaDao(): AnalistaDao

    companion object {
        fun crear(context: Context): BaseLocal =
            Room.databaseBuilder(context, BaseLocal::class.java, "queseria.db")
                .addMigrations(MIGRATION_1_2)
                .build()

        internal val MIGRATION_1_2 = object : androidx.room.migration.Migration(1, 2) {
            override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
                db.execSQL("""CREATE TABLE IF NOT EXISTS entrega_analista (
                    id TEXT NOT NULL PRIMARY KEY, productor_id INTEGER NOT NULL,
                    productor_codigo TEXT NOT NULL, productor TEXT NOT NULL,
                    tipo_productor TEXT NOT NULL, acopiador TEXT, litros REAL NOT NULL,
                    registrada_en TEXT NOT NULL, observacion TEXT, estado_calidad TEXT NOT NULL,
                    revisada INTEGER NOT NULL, anulada INTEGER NOT NULL, ph REAL,
                    temperatura_c REAL, grasa_pct REAL, densidad REAL,
                    antibioticos_positivo INTEGER, foto_url TEXT, registrada_en_ms INTEGER NOT NULL)""")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_entrega_analista_estado_calidad ON entrega_analista(estado_calidad)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_entrega_analista_registrada_en_ms ON entrega_analista(registrada_en_ms)")
                db.execSQL("""CREATE TABLE IF NOT EXISTS revision_calidad (
                    recoleccion_id TEXT NOT NULL PRIMARY KEY, estado TEXT NOT NULL,
                    ph TEXT, temperatura_c TEXT, grasa_pct TEXT, densidad TEXT,
                    antibioticos_positivo INTEGER, foto_uri TEXT,
                    calidad_sincronizada INTEGER NOT NULL DEFAULT 0)""")
            }
        }
    }
}
