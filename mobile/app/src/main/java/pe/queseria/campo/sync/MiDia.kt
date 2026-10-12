package pe.queseria.campo.sync

import pe.queseria.campo.datos.local.EstadoSync
import pe.queseria.campo.datos.local.RecoleccionEntidad
import pe.queseria.campo.datos.local.SyncDao
import pe.queseria.campo.datos.remoto.ApiQueseria
import pe.queseria.campo.datos.remoto.ErrorApp
import pe.queseria.campo.datos.remoto.MiDiaDto
import pe.queseria.campo.datos.remoto.llamar
import java.math.BigDecimal
import java.math.RoundingMode
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

data class ResumenMiDia(
    val fecha: LocalDate,
    val totalLitros: BigDecimal,
    val nRecolecciones: Int,
    /** Del servidor (ya recibidas hoy), si hubo red. */
    val servidor: MiDiaDto?,
    /** Registradas en el celular hoy y aún no confirmadas por el servidor. */
    val pendientes: List<RecoleccionEntidad>,
    val rechazadas: List<RecoleccionEntidad>,
    /** true = no hubo red: el total es solo lo del celular. */
    val sinSincronizar: Boolean,
)

/**
 * "Mi día": con red, lo que el servidor ya recibió (GET /acopiador/mi-dia, sin las anuladas) más lo
 * pendiente en Room. Sin red, se calcula todo desde Room y se marca "sin sincronizar".
 */
class MiDia(
    private val api: () -> ApiQueseria,
    private val bearer: () -> String,
    private val dao: SyncDao,
    private val reloj: () -> Instant = Instant::now,
) {
    suspend fun obtener(): ResumenMiDia {
        val hoy = reloj().atZone(LIMA).toLocalDate()
        val desde = hoy.atStartOfDay(LIMA).toInstant().toEpochMilli()
        val hasta = hoy.plusDays(1).atStartOfDay(LIMA).toInstant().toEpochMilli()
        val locales = dao.recoleccionesEntre(desde, hasta)
        val pendientes = locales.filter { it.estadoSync == EstadoSync.PENDIENTE }
        val rechazadas = locales.filter { it.estadoSync == EstadoSync.RECHAZADO }

        val servidor = try {
            llamar { api().miDia(bearer()) }
        } catch (e: ErrorApp) {
            if (e.esTransitorio || e is ErrorApp.NoAutorizado) null else throw e
        }
        return if (servidor != null) {
            ResumenMiDia(
                fecha = hoy,
                totalLitros = BigDecimal(servidor.totalLitros.toString()).add(suma(pendientes)).setScale(2, RoundingMode.HALF_UP),
                nRecolecciones = servidor.nRecolecciones + pendientes.size,
                servidor = servidor, pendientes = pendientes, rechazadas = rechazadas, sinSincronizar = false,
            )
        } else {
            val validas = locales.filter { it.estadoSync != EstadoSync.RECHAZADO }
            ResumenMiDia(
                fecha = hoy, totalLitros = suma(validas).setScale(2, RoundingMode.HALF_UP), nRecolecciones = validas.size,
                servidor = null, pendientes = pendientes, rechazadas = rechazadas, sinSincronizar = true,
            )
        }
    }

    private fun suma(rs: List<RecoleccionEntidad>) = rs.fold(BigDecimal.ZERO) { s, r -> s + BigDecimal(r.litros) }

    private companion object {
        val LIMA: ZoneId = ZoneId.of("America/Lima")
    }
}
