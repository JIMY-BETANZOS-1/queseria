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
                RecoleccionEntidad::class, MetaEntidad::class],
    version = 1,
    exportSchema = true,
)
abstract class BaseLocal : RoomDatabase() {
    abstract fun syncDao(): SyncDao

    companion object {
        fun crear(context: Context): BaseLocal =
            Room.databaseBuilder(context, BaseLocal::class.java, "queseria.db").build()
    }
}
