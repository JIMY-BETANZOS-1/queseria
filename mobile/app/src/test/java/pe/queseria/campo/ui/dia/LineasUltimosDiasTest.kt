package pe.queseria.campo.ui.dia

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import pe.queseria.campo.datos.local.EstadoSync
import pe.queseria.campo.datos.local.RecoleccionEntidad
import pe.queseria.campo.datos.remoto.MiDiaDto
import pe.queseria.campo.datos.remoto.RecoleccionMiDiaDto
import pe.queseria.campo.sync.MiDia
import pe.queseria.campo.ui.inicio.Insignia
import pe.queseria.campo.ui.sync.TextosSync
import java.time.Instant
import java.time.LocalDate

/** "Últimos días" (B6b): una fila por día, hoy arriba, sin inventar totales cuando no hay señal. */
class LineasUltimosDiasTest {

    private val hoy = LocalDate.of(2026, 10, 17)   // sábado

    private fun local(id: String, instante: String, estadoSync: String = EstadoSync.PENDIENTE) = RecoleccionEntidad(
        id = id, productorId = 9, productorUuidCliente = null, litros = "8.00", observacion = null,
        registradaEn = instante, latitud = null, longitud = null, precisionM = null,
        origenUbicacion = "ninguna", ubicacionSimulada = false, horaGps = null, horaAutomatica = true,
        hashAnterior = null, firma = "f", productorNombre = "Rosa Condori",
        registradaEnMs = Instant.parse(instante).toEpochMilli(), estadoSync = estadoSync, motivo = null,
    )

    private fun dia(fecha: LocalDate, vararg litros: Double) = MiDiaDto(
        fecha.toString(), litros.sum(), litros.size,
        litros.mapIndexed { i, l ->
            RecoleccionMiDiaDto(
                recoleccionId = "$fecha-$i", registradaEn = "${fecha}T07:0$i:00-05:00", productorId = 9,
                productorCodigo = "P-0009", productor = "Rosa Condori", litros = l, estadoCalidad = "normal",
                revisada = false, anuladaEn = null,
            )
        },
    )

    @Test
    fun `con red cada dia lleva su total, hoy arriba y el singular bien`() {
        val h = MiDia.armarHistorial(
            hoy, listOf(dia(hoy, 100.0, 42.0), dia(hoy.minusDays(1), 31.5)), emptyList(),
        )

        val filas = LineasUltimosDias.filas(h)

        assertEquals(7, filas.size)
        assertEquals("Hoy", filas[0].titulo)
        assertEquals("142.00 L · 2 entregas", filas[0].total)
        assertEquals("vie 16 oct", filas[1].titulo)
        assertEquals("31.50 L · 1 entrega", filas[1].total)
        assertEquals("dom 11 oct", filas[6].titulo)
        assertTrue(filas.drop(2).all { it.total == "Sin entregas" })
        assertTrue(filas.all { it.marcas.isEmpty() })
    }

    @Test
    fun `lo sin enviar va en ambar y lo rechazado en rojo`() {
        val h = MiDia.armarHistorial(
            hoy, listOf(dia(hoy.minusDays(1), 10.0)),
            listOf(
                local("p1", "2026-10-16T13:00:00Z"),
                local("r1", "2026-10-16T14:00:00Z", EstadoSync.RECHAZADO),
                local("r2", "2026-10-16T15:00:00Z", EstadoSync.RECHAZADO),
            ),
        )

        val ayer = LineasUltimosDias.filas(h)[1]

        assertEquals("18.00 L · 2 entregas", ayer.total)  // lo pendiente suma, lo rechazado no
        assertEquals(
            listOf(Insignia("1 sin enviar", TextosSync.Tono.ADVERTENCIA), Insignia("2 rechazadas", TextosSync.Tono.ERROR)),
            ayer.marcas,
        )
    }

    @Test
    fun `sin red los dias anteriores dicen Sin conexion y conservan sus marcas`() {
        val h = MiDia.armarHistorial(
            hoy, null,
            listOf(local("h1", "2026-10-17T13:00:00Z"), local("a1", "2026-10-16T13:00:00Z")),
        )

        val filas = LineasUltimosDias.filas(h)

        assertEquals("hoy tiene el total del celular", "8.00 L · 1 entrega", filas[0].total)
        assertTrue(filas.drop(1).all { it.total == "Sin conexión" })
        assertEquals(listOf(Insignia("1 sin enviar", TextosSync.Tono.ADVERTENCIA)), filas[1].marcas)
        assertTrue(filas.drop(2).all { it.marcas.isEmpty() })
    }
}
