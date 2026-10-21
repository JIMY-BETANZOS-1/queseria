package pe.queseria.campo.datos.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

/**
 * Base local del celular. Sin fallbackToDestructiveMigration: un cambio de versión NUNCA debe borrar
 * recolecciones sin sincronizar (cada cambio de esquema lleva su Migration).
 */
@Database(
    entities = [ProductorEntidad::class, RutaEntidad::class, EstadoProductorEntidad::class,
                RecoleccionEntidad::class, ReporteAnalistaEntidad::class, MetaEntidad::class],
    version = 3,
    exportSchema = true,
)
abstract class BaseLocal : RoomDatabase() {
    abstract fun syncDao(): SyncDao
    abstract fun analistaDao(): AnalistaDao

    companion object {
        fun crear(context: Context): BaseLocal =
            Room.databaseBuilder(context, BaseLocal::class.java, "queseria.db")
                .addMigrations(MIGRATION_1_2, MIGRATION_2_3)
                .build()

        /** Primera versión del analista (entregas del día y revisión de calidad): sus tablas las retira la 3. */
        internal val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
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

        /**
         * 0.8.0: el analista ya no revisa entregas en el celular (solo reporta): fuera entrega_analista y
         * revision_calidad, y entra la cola reporte_analista. Lo del acopiador (productor, ruta, recoleccion, meta)
         * no se toca.
         */
        internal val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("DROP TABLE IF EXISTS entrega_analista")
                db.execSQL("DROP TABLE IF EXISTS revision_calidad")
                db.execSQL("""CREATE TABLE IF NOT EXISTS reporte_analista (
                    id TEXT NOT NULL PRIMARY KEY, productor_clave TEXT NOT NULL, productor_nombre TEXT NOT NULL,
                    comentario TEXT, foto_ruta TEXT, creado_en_ms INTEGER NOT NULL, estado TEXT NOT NULL,
                    motivo TEXT, intentos INTEGER NOT NULL, enviado_en_ms INTEGER)""")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_reporte_analista_productor_clave ON reporte_analista(productor_clave)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_reporte_analista_estado ON reporte_analista(estado)")
            }
        }
    }
}
