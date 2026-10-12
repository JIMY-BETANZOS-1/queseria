package pe.queseria.campo

import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import pe.queseria.campo.datos.local.BaseLocal
import pe.queseria.campo.datos.local.EstadoSync
import pe.queseria.campo.datos.local.ProductorEntidad
import pe.queseria.campo.datos.local.RutaEntidad
import pe.queseria.campo.datos.local.SyncDao
import pe.queseria.campo.registro.ArmadoRecoleccion
import pe.queseria.campo.registro.NuevaRecoleccion
import java.math.BigDecimal
import java.time.Instant
import java.util.UUID

/** Room real (en memoria) en el celular: cola de pendientes y pull en transacción. */
@RunWith(AndroidJUnit4::class)
class BaseLocalTest {
    private lateinit var base: BaseLocal
    private lateinit var dao: SyncDao

    @Before
    fun abrir() {
        base = Room.inMemoryDatabaseBuilder(InstrumentationRegistry.getInstrumentation().targetContext, BaseLocal::class.java).build()
        dao = base.syncDao()
    }

    @After
    fun cerrar() = base.close()

    private fun recoleccion(ms: Long) = ArmadoRecoleccion.armar(
        NuevaRecoleccion(7, null, "Juana", BigDecimal("12.3"), "obs", null, true),
        UUID.randomUUID().toString(), Instant.ofEpochMilli(ms), null,
    ) { "firma" }

    @Test
    fun colaDePendientesEnOrdenYConfirmacion() = runTest {
        val a = recoleccion(2_000)
        val b = recoleccion(1_000)
        dao.insertarRecoleccion(a)
        dao.insertarRecoleccion(b)
        assertEquals(listOf(b.id, a.id), dao.recoleccionesPendientes(10).map { it.id })

        dao.sumarIntento(listOf(a.id, b.id), "Sin conexión con el servidor")
        dao.recoleccionSincronizada(b.id, "sin_ubicacion", 5_000)
        dao.recoleccionRechazada(a.id, "motivo")
        assertTrue(dao.recoleccionesPendientes(10).isEmpty())

        val guardadas = dao.recoleccionesEntre(0, 10_000).associateBy { it.id }
        assertEquals(EstadoSync.SINCRONIZADO, guardadas.getValue(b.id).estadoSync)
        assertEquals(1, guardadas.getValue(b.id).intentos)
        assertEquals("12.30", guardadas.getValue(b.id).litros)
        assertEquals("motivo", guardadas.getValue(a.id).motivo)
    }

    @Test
    fun pullBorraNoVigentesPeroNoLasAltasDeCampo() = runTest {
        val campo = UUID.randomUUID().toString()
        dao.insertarProductor(ProductorEntidad(campo, null, campo, null, "Alta", null, null, 3, null, null, false,
            null, EstadoSync.PENDIENTE, null, 0))
        dao.upsertProductores(listOf(ProductorEntidad("id:55", 55, null, "P-0055", "Fuera", null, null, 9,
            null, null, true, "t", EstadoSync.SINCRONIZADO, null, 0)))
        // Más de 999 ids vigentes: el borrado no debe superar el límite de parámetros de SQLite
        val vigentes = (1L..1500L).toSet()
        dao.aplicarPull(
            rutas = listOf(RutaEntidad(3, "Huata", null, "t")), rutaIdsVigentes = setOf(3),
            productores = listOf(ProductorEntidad("id:7", 7, null, "P-0007", "Juana", null, null, 3, null, null,
                true, "t", EstadoSync.SINCRONIZADO, null, 0)),
            productorIdsVigentes = vigentes - 55, estados = emptyList(), meta = emptyList(), purgarAntesDeMs = 0,
        )
        val pendientes = dao.productoresPendientes(10)
        assertEquals(listOf(campo), pendientes.map { it.clave })
        assertEquals(listOf(3L), dao.idsRutas())
        assertEquals(listOf(7L), dao.idsProductoresDelServidor())
    }
}
