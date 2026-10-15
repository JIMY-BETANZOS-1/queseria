package pe.queseria.campo

import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import pe.queseria.campo.datos.local.BaseLocal
import pe.queseria.campo.datos.local.EstadoProductorEntidad
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

    private fun recoleccion(
        ms: Long,
        productorId: Long? = 7,
        uuid: String? = null,
        litros: String = "12.3",
    ) = ArmadoRecoleccion.armar(
        NuevaRecoleccion(productorId, uuid, "Juana", BigDecimal(litros), "obs", null, true),
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

    /** B3: la lista junta productor + ruta + sanción del pull + lo registrado hoy en este celular. */
    @Test
    fun misProductoresConEstadoYLitrosDeHoy() = runTest {
        val campo = UUID.randomUUID().toString()
        dao.upsertRutas(listOf(RutaEntidad(3, "Huata Norte", null, "t")))
        dao.upsertProductores(listOf(ProductorEntidad("id:7", 7, null, "P-0007", "Juana Mamani", null, null, 3,
            null, null, true, "t", EstadoSync.SINCRONIZADO, null, 0)))
        dao.insertarProductor(ProductorEntidad(campo, null, campo, null, "Alta de campo", null, null, 3,
            null, null, false, null, EstadoSync.PENDIENTE, null, 0))
        dao.insertarEstados(listOf(EstadoProductorEntidad(7, sancionado = true, bloqueado = true,
            sancionHasta = "2026-10-21")))

        // Dos entregas de Juana el mismo día: las dos cuentan y se suman (varias por día están permitidas)
        dao.insertarRecoleccion(recoleccion(1_000, litros = "12.3"))
        dao.insertarRecoleccion(recoleccion(2_000, litros = "10.2"))
        val rechazada = recoleccion(3_000, litros = "99")
        dao.insertarRecoleccion(rechazada)
        dao.recoleccionRechazada(rechazada.id, "motivo")                                // no cuenta
        dao.insertarRecoleccion(recoleccion(4_000, productorId = null, uuid = campo, litros = "8"))
        dao.insertarRecoleccion(recoleccion(20_000, litros = "50"))                      // fuera del día

        val filas = dao.observarProductores(desdeMs = 0, hastaMs = 10_000).first()
        assertEquals("ordena por nombre", listOf("Alta de campo", "Juana Mamani"), filas.map { it.nombre })

        val juana = filas.single { it.servidorId == 7L }
        assertEquals("Huata Norte", juana.rutaNombre)
        assertTrue(juana.sancionado)
        assertTrue(juana.bloqueado)
        assertEquals("2026-10-21", juana.sancionHasta)
        assertEquals("suma las 2 entregas del día; no cuenta la rechazada ni la de otro día", 2, juana.nHoy)
        assertEquals(22.5, juana.litrosHoy, 0.001)

        val alta = filas.single { it.clave == campo }
        assertFalse("el alta de campo nace no aprobada", alta.aprobado)
        assertEquals(EstadoSync.PENDIENTE, alta.estadoSync)
        assertEquals("se empareja por uuid_cliente, sin id del servidor", 1, alta.nHoy)
        assertEquals(8.0, alta.litrosHoy, 0.001)
        assertFalse(alta.sancionado)

        // La consulta de una sola fila (B4) ve lo mismo
        val sola = dao.observarProductor(campo, desdeMs = 0, hastaMs = 10_000).first()
        assertEquals(campo, sola?.clave)
        assertEquals(1, sola?.nHoy)
    }
}
