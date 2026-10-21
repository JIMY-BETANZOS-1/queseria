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

    @Test
    fun migraDeRoom1A2YConservaDatosExistentes() {
        helper.createDatabase("migracion-1-2", 1).apply {
            execSQL(
                """INSERT INTO meta (clave, valor) VALUES ('cursor_pull', 'cursor-anterior')""",
            )
            close()
        }

        val db = helper.runMigrationsAndValidate(
            "migracion-1-2", 2, true, BaseLocal.MIGRATION_1_2,
        )
        db.query("SELECT valor FROM meta WHERE clave = 'cursor_pull'").use { cursor ->
            check(cursor.moveToFirst())
            assertEquals("cursor-anterior", cursor.getString(0))
        }
        db.query("PRAGMA table_info(revision_calidad)").use { cursor ->
            val columnas = buildSet {
                while (cursor.moveToNext()) add(cursor.getString(1))
            }
            assertEquals(true, "foto_uri" in columnas)
            assertEquals(true, "calidad_sincronizada" in columnas)
        }
    }
}
