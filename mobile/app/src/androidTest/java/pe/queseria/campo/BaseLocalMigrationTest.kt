package pe.queseria.campo

import androidx.room.testing.MigrationTestHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import pe.queseria.campo.datos.local.BaseLocal

@RunWith(AndroidJUnit4::class)
class BaseLocalMigrationTest {
    @get:Rule
    val helper = MigrationTestHelper(
        InstrumentationRegistry.getInstrumentation(),
        BaseLocal::class.java,
        emptyList(),
        FrameworkSQLiteOpenHelperFactory(),
    )

    private fun tablas(db: androidx.sqlite.db.SupportSQLiteDatabase): Set<String> =
        db.query("SELECT name FROM sqlite_master WHERE type = 'table'").use { c ->
            buildSet { while (c.moveToNext()) add(c.getString(0)) }
        }

    /** La 0.7.0 está en la versión 1: al instalar la 0.8.0 pasa por 1 → 2 → 3 sin perder lo del acopiador. */
    @Test
    fun migraDe1A3ConservaDatosDelAcopiador() {
        helper.createDatabase("migracion-1-3", 1).apply {
            execSQL("INSERT INTO meta (clave, valor) VALUES ('cursor_pull', 'cursor-anterior')")
            close()
        }
        val db = helper.runMigrationsAndValidate("migracion-1-3", 3, true, BaseLocal.MIGRATION_1_2, BaseLocal.MIGRATION_2_3)
        db.query("SELECT valor FROM meta WHERE clave = 'cursor_pull'").use { cursor ->
            check(cursor.moveToFirst())
            assertEquals("cursor-anterior", cursor.getString(0))
        }
        val t = tablas(db)
        assertEquals(true, "reporte_analista" in t)
        assertEquals(false, "entrega_analista" in t || "revision_calidad" in t)
    }

    @Test
    fun migraDe2A3RetiraLasTablasDeCalidad() {
        helper.createDatabase("migracion-2-3", 2).close()
        val db = helper.runMigrationsAndValidate("migracion-2-3", 3, true, BaseLocal.MIGRATION_2_3)
        db.execSQL("""INSERT INTO reporte_analista (id, productor_clave, productor_nombre, comentario, foto_ruta,
                      creado_en_ms, estado, motivo, intentos, enviado_en_ms)
                      VALUES ('r1', 'id:7', 'Cirilo', 'Tarro sucio', NULL, 1, 'SOLO_CELULAR', NULL, 0, NULL)""")
        db.query("SELECT COUNT(*) FROM reporte_analista").use { c ->
            check(c.moveToFirst())
            assertEquals(1, c.getInt(0))
        }
        assertEquals(false, "revision_calidad" in tablas(db))
    }
}
