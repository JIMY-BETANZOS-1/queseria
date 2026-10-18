package pe.queseria.campo.ui.dia

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import pe.queseria.campo.datos.local.EstadoSync
import pe.queseria.campo.datos.local.RecoleccionEntidad
import pe.queseria.campo.datos.remoto.MiDiaDto
import pe.queseria.campo.datos.remoto.RecoleccionMiDiaDto
import pe.queseria.campo.sync.ResumenMiDia
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate

/**
 * "Mi día" (B6): lo que el servidor ya recibió más lo que sigue en el celular, en hora de Lima.
 * Las anuladas y las rechazadas aparecen pero no suman.
 */
class LineasMiDiaTest {

    private fun delServidor(
        id: String = "aaaa",
        registradaEn: String = "2026-10-15T07:05:09.120000-05:00",
        productor: String = "Juana Mamani",
        litros: Double = 23.5,
        estadoCalidad: String = "normal",
        anuladaEn: String? = null,
    ) = RecoleccionMiDiaDto(
        recoleccionId = id, registradaEn = registradaEn, productorId = 7, productorCodigo = "P-0007",
        productor = productor, litros = litros, estadoCalidad = estadoCalidad, revisada = false,
        anuladaEn = anuladaEn,
    )

    private fun local(
        id: String = "bbbb",
        horaMs: Long = Instant.parse("2026-10-15T13:40:00Z").toEpochMilli(),  // 08:40 en Lima
        productor: String = "Rosa Condori",
        litros: String = "8.00",
        estadoSync: String = EstadoSync.PENDIENTE,
        motivo: String? = null,
    ) = RecoleccionEntidad(
        id = id, productorId = 9, productorUuidCliente = null, litros = litros, observacion = null,
        registradaEn = "2026-10-15T13:40:00.000Z", latitud = null, longitud = null, precisionM = null,
        origenUbicacion = "ninguna", ubicacionSimulada = false, horaGps = null, horaAutomatica = true,
        hashAnterior = null, firma = "f", productorNombre = productor, registradaEnMs = horaMs,
        estadoSync = estadoSync, motivo = motivo,
    )

    private fun resumen(
        servidor: List<RecoleccionMiDiaDto>? = null,
        pendientes: List<RecoleccionEntidad> = emptyList(),
        rechazadas: List<RecoleccionEntidad> = emptyList(),
        totalLitros: String = "0.00",
        n: Int = 0,
        sinTotal: Boolean = false,
    ) = ResumenMiDia(
        fecha = LocalDate.of(2026, 10, 15),
        totalLitros = BigDecimal(totalLitros),
        nRecolecciones = n,
        servidor = servidor?.let { MiDiaDto("2026-10-15", it.sumOf { r -> r.litros }, it.size, it) },
        pendientes = pendientes,
        rechazadas = rechazadas,
        sinSincronizar = servidor == null,
        sinTotal = sinTotal,
    )

    @Test
    fun `la fecha se escribe en espanol y sin depender del Locale`() {
        assertEquals("jue 15 oct", LineasMiDia.fechaLarga(LocalDate.of(2026, 10, 15)))
        assertEquals("dom 1 feb", LineasMiDia.fechaLarga(LocalDate.of(2026, 2, 1)))
        assertEquals("mié 30 set", LineasMiDia.fechaLarga(LocalDate.of(2026, 9, 30)))
    }

    @Test
    fun `el total dice litros y entregas, con el singular bien`() {
        assertEquals("23.50 L · 1 entrega", LineasMiDia.total(resumen(totalLitros = "23.5", n = 1)))
        assertEquals("123.50 L · 8 entregas", LineasMiDia.total(resumen(totalLitros = "123.5", n = 8)))
        assertEquals("0.00 L · 0 entregas", LineasMiDia.total(resumen()))
    }

    @Test
    fun `la hora del servidor se pasa a la de Lima`() {
        val l = LineasMiDia.lineas(resumen(servidor = listOf(delServidor()))).single()

        assertEquals("07:05", l.hora)
        assertEquals("23.50", l.litros)
        assertEquals("Juana Mamani", l.productor)
        assertNull("una entrega enviada y normal no necesita etiqueta", l.etiqueta)
        assertTrue(l.suma)
        assertFalse(l.problema)
    }

    @Test
    fun `una hora en UTC tambien se pasa a Lima`() {
        val l = LineasMiDia.lineas(
            resumen(servidor = listOf(delServidor(registradaEn = "2026-10-15T12:05:09.120Z"))),
        ).single()
        assertEquals("07:05", l.hora)
    }

    @Test
    fun `una fecha que no se entiende no tumba la fila`() {
        val l = LineasMiDia.lineas(resumen(servidor = listOf(delServidor(registradaEn = "ayer")))).single()

        assertEquals("--:--", l.hora)
        assertEquals("pero los litros siguen a la vista", "23.50", l.litros)
    }

    @Test
    fun `la anulada aparece marcada y no suma`() {
        val l = LineasMiDia.lineas(
            resumen(servidor = listOf(delServidor(anuladaEn = "2026-10-15T18:00:00-05:00"))),
        ).single()

        assertEquals("Anulada", l.etiqueta)
        assertTrue(l.problema)
        assertFalse("el servidor ya la descontó del total", l.suma)
    }

    @Test
    fun `la alterada se marca pero sigue sumando`() {
        val l = LineasMiDia.lineas(
            resumen(servidor = listOf(delServidor(estadoCalidad = "alterado"))),
        ).single()

        assertEquals("Alterada", l.etiqueta)
        assertFalse(l.problema)
        assertTrue("la leche alterada se paga; lo que se descarta es la leche", l.suma)
    }

    @Test
    fun `lo del celular y lo del servidor se mezclan por hora`() {
        val r = resumen(
            servidor = listOf(delServidor(id = "aaaa")),                       // 07:05
            pendientes = listOf(local(id = "bbbb")),                           // 08:40
            rechazadas = listOf(
                local(id = "cccc", horaMs = Instant.parse("2026-10-15T12:30:00Z").toEpochMilli(),
                      estadoSync = EstadoSync.RECHAZADO, motivo = "Un acopiador solo registra productores de ruta"),
            ),
            totalLitros = "31.5", n = 2,
        )

        val ls = LineasMiDia.lineas(r)

        // 07:05 del servidor, 07:30 rechazada y 08:40 pendiente: el orden es el de la jornada
        assertEquals(listOf("07:05", "07:30", "08:40"), ls.map { it.hora })
        assertEquals(listOf("aaaa", "cccc", "bbbb"), ls.map { it.id })
        assertEquals("Sin enviar", ls.single { it.id == "bbbb" }.etiqueta)
        assertTrue("lo pendiente ya cuenta para el acopiador", ls.single { it.id == "bbbb" }.suma)

        val rechazada = ls.single { it.id == "cccc" }
        assertEquals("Rechazada: Un acopiador solo registra productores de ruta", rechazada.etiqueta)
        assertTrue(rechazada.problema)
        assertFalse(rechazada.suma)
    }

    @Test
    fun `sin red solo se ve lo del celular`() {
        val ls = LineasMiDia.lineas(resumen(pendientes = listOf(local()), totalLitros = "8.00", n = 1))

        assertEquals(1, ls.size)
        assertEquals("08:40", ls.single().hora)
        assertEquals("Sin enviar", ls.single().etiqueta)
    }

    @Test
    fun `un dia anterior sin red no inventa el total`() {
        val r = resumen(pendientes = listOf(local()), totalLitros = "0.00", n = 0, sinTotal = true)

        assertEquals("Sin conexión", LineasMiDia.total(r))
        assertNull("sin total no hay a qué sumarle lo pendiente", LineasMiDia.incluyeSinEnviar(r))
        assertEquals("Sin enviar", LineasMiDia.lineas(r).single().etiqueta)
    }

    @Test
    fun `bajo el total se avisa cuanto falta enviar`() {
        assertEquals(
            "Incluye 1 sin enviar",
            LineasMiDia.incluyeSinEnviar(resumen(servidor = listOf(delServidor()), pendientes = listOf(local()))),
        )
        assertNull(LineasMiDia.incluyeSinEnviar(resumen(servidor = listOf(delServidor()))))
    }

    @Test
    fun `la lista vacia se explica segun el dia`() {
        assertEquals("Todavía no hay entregas registradas hoy.", LineasMiDia.sinEntregas(resumen(servidor = emptyList()), esHoy = true))
        assertEquals("No hubo entregas ese día.", LineasMiDia.sinEntregas(resumen(servidor = emptyList()), esHoy = false))
        assertEquals(
            "Este celular no tiene nada pendiente de ese día.",
            LineasMiDia.sinEntregas(resumen(sinTotal = true), esHoy = false),
        )
    }

    @Test
    fun `una rechazada sin motivo no deja la etiqueta a medias`() {
        val ls = LineasMiDia.lineas(
            resumen(rechazadas = listOf(local(estadoSync = EstadoSync.RECHAZADO, motivo = null))),
        )
        assertEquals("Rechazada: sin motivo", ls.single().etiqueta)
    }
}
