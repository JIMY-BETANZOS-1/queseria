package pe.queseria.campo.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import pe.queseria.campo.datos.local.EstadoSync
import pe.queseria.campo.datos.local.RecoleccionEntidad
import pe.queseria.campo.datos.remoto.MiDiaDto
import pe.queseria.campo.datos.remoto.RecoleccionMiDiaDto
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate

/**
 * Armado de "Mi día" y "Últimos días": lo del servidor más lo de Room, por día en hora de Lima,
 * sin contar dos veces lo que está a los dos lados y sin inventar totales de días anteriores sin red.
 */
class ArmarDiaTest {

    private val hoy = LocalDate.of(2026, 10, 17)
    private val ayer = hoy.minusDays(1)

    private fun local(
        id: String,
        instante: String,
        litros: String = "8.00",
        estadoSync: String = EstadoSync.PENDIENTE,
    ) = RecoleccionEntidad(
        id = id, productorId = 9, productorUuidCliente = null, litros = litros, observacion = null,
        registradaEn = instante, latitud = null, longitud = null, precisionM = null,
        origenUbicacion = "ninguna", ubicacionSimulada = false, horaGps = null, horaAutomatica = true,
        hashAnterior = null, firma = "f", productorNombre = "Rosa Condori",
        registradaEnMs = Instant.parse(instante).toEpochMilli(), estadoSync = estadoSync, motivo = null,
    )

    private fun delServidor(id: String, litros: Double) = RecoleccionMiDiaDto(
        recoleccionId = id, registradaEn = "2026-10-17T07:05:00-05:00", productorId = 9, productorCodigo = "P-0009",
        productor = "Rosa Condori", litros = litros, estadoCalidad = "normal", revisada = false, anuladaEn = null,
    )

    private fun dia(fecha: LocalDate, vararg rs: RecoleccionMiDiaDto) =
        MiDiaDto(fecha.toString(), rs.sumOf { it.litros }, rs.size, rs.toList())

    @Test
    fun `con red suma el servidor y lo pendiente`() {
        val r = MiDia.armarDia(
            hoy, dia(hoy, delServidor("aaaa", 20.5)),
            listOf(local("bbbb", "2026-10-17T13:40:00Z", "8.00")), esHoy = true,
        )

        assertEquals(BigDecimal("28.50"), r.totalLitros)
        assertEquals(2, r.nRecolecciones)
        assertEquals(listOf("bbbb"), r.pendientes.map { it.id })
        assertFalse(r.sinSincronizar)
        assertFalse(r.sinTotal)
    }

    @Test
    fun `lo pendiente que el servidor ya tiene no se cuenta dos veces`() {
        // El push llegó pero la respuesta se perdió: en Room sigue PENDIENTE
        val r = MiDia.armarDia(
            hoy, dia(hoy, delServidor("AAAA-1", 20.5)),
            listOf(local("aaaa-1", "2026-10-17T12:05:00Z", "20.50")), esHoy = true,
        )

        assertEquals(BigDecimal("20.50"), r.totalLitros)
        assertEquals(1, r.nRecolecciones)
        assertTrue(r.pendientes.isEmpty())
    }

    @Test
    fun `el dia se corta en hora de Lima y no en UTC`() {
        // 04:30 UTC del 17 = 23:30 del 16 en Lima
        val tarde = local("cccc", "2026-10-17T04:30:00Z")

        assertEquals(listOf("cccc"), MiDia.armarDia(ayer, null, listOf(tarde), esHoy = false).pendientes.map { it.id })
        assertTrue(MiDia.armarDia(hoy, null, listOf(tarde), esHoy = true).pendientes.isEmpty())
    }

    @Test
    fun `hoy sin red suma lo del celular, incluido lo ya enviado, pero no lo rechazado`() {
        val r = MiDia.armarDia(
            hoy, null,
            listOf(
                local("e1", "2026-10-17T12:00:00Z", "10.00", EstadoSync.SINCRONIZADO),
                local("p1", "2026-10-17T13:00:00Z", "5.00"),
                local("r1", "2026-10-17T14:00:00Z", "7.00", EstadoSync.RECHAZADO),
            ),
            esHoy = true,
        )

        assertEquals(BigDecimal("15.00"), r.totalLitros)
        assertEquals(2, r.nRecolecciones)
        assertTrue(r.sinSincronizar)
        assertFalse(r.sinTotal)
    }

    @Test
    fun `un dia anterior sin red no tiene total y solo trae lo sin enviar y lo rechazado`() {
        val r = MiDia.armarDia(
            ayer, null,
            listOf(
                local("e1", "2026-10-16T12:00:00Z", "10.00", EstadoSync.SINCRONIZADO),
                local("p1", "2026-10-16T13:00:00Z", "5.00"),
                local("r1", "2026-10-16T14:00:00Z", "7.00", EstadoSync.RECHAZADO),
            ),
            esHoy = false,
        )

        assertTrue(r.sinTotal)
        assertTrue(r.sinSincronizar)
        assertNull(r.servidor)
        assertEquals(listOf("p1"), r.pendientes.map { it.id })
        assertEquals(listOf("r1"), r.rechazadas.map { it.id })
    }

    @Test
    fun `el historial trae los 7 dias de hoy hacia atras, tambien los vacios`() {
        val h = MiDia.armarHistorial(
            hoy,
            listOf(dia(hoy, delServidor("aaaa", 20.5)), dia(ayer, delServidor("bbbb", 14.25))),
            emptyList(),
        )

        assertFalse(h.sinConexion)
        assertEquals((0L..6L).map { hoy.minusDays(it) }, h.dias.map { it.fecha })
        assertEquals(BigDecimal("20.50"), h.dias[0].totalLitros)
        assertEquals(BigDecimal("14.25"), h.dias[1].totalLitros)
        // Un día que el servidor no mandó cuenta como vacío y con total (no "sin conexión")
        h.dias.drop(2).forEach {
            assertEquals(0, it.nRecolecciones)
            assertFalse(it.sinTotal)
        }
    }

    @Test
    fun `el historial sin red reparte lo del celular por dia y solo hoy lleva total`() {
        val h = MiDia.armarHistorial(
            hoy, null,
            listOf(
                local("hoy1", "2026-10-17T13:00:00Z", "5.00"),
                local("ayer1", "2026-10-16T13:00:00Z", "6.00"),
                local("ayer2", "2026-10-16T14:00:00Z", "4.00", EstadoSync.RECHAZADO),
            ),
        )

        assertTrue(h.sinConexion)
        assertEquals(BigDecimal("5.00"), h.dias[0].totalLitros)
        assertFalse(h.dias[0].sinTotal)
        assertTrue(h.dias.drop(1).all { it.sinTotal })
        assertEquals(listOf("ayer1"), h.dias[1].pendientes.map { it.id })
        assertEquals(listOf("ayer2"), h.dias[1].rechazadas.map { it.id })
    }
}
