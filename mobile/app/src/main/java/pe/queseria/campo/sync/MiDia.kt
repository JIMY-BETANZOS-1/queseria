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
    /** Del servidor (ya recibidas ese día), si hubo red. */
    val servidor: MiDiaDto?,
    /** Registradas en el celular ese día y que el servidor todavía no conoce. */
    val pendientes: List<RecoleccionEntidad>,
    val rechazadas: List<RecoleccionEntidad>,
    /** true = no hubo red: el total (si lo hay) es solo lo del celular. */
    val sinSincronizar: Boolean,
    /**
     * true = día anterior sin red: no hay total. Lo ya enviado de ese día solo lo sabe el servidor
     * (anulaciones, otro celular, reinstalación), así que no se arma una cifra con Room.
     */
    val sinTotal: Boolean = false,
)

/** "Últimos días" (B6b): hoy primero y los días anteriores, uno por día aunque no haya entregas. */
data class HistorialDias(val dias: List<ResumenMiDia>, val sinConexion: Boolean)

/**
 * "Mi día": con red, lo que el servidor ya recibió (GET /acopiador/mi-dia, sin las anuladas) más lo
 * pendiente en Room. Sin red, se calcula todo desde Room y se marca "sin sincronizar".
 * "Últimos días": lo mismo para hoy y los días anteriores (GET /acopiador/ultimos-dias).
 */
class MiDia(
    private val api: () -> ApiQueseria,
    private val bearer: () -> String,
    private val dao: SyncDao,
    private val reloj: () -> Instant = Instant::now,
) {
    suspend fun obtener(): ResumenMiDia {
        val hoy = reloj().atZone(LIMA).toLocalDate()
        val locales = dao.recoleccionesEntre(inicio(hoy), inicio(hoy.plusDays(1)))
        return armarDia(hoy, consultar { api().miDia(bearer()) }, locales, esHoy = true)
    }

    suspend fun ultimosDias(): HistorialDias {
        val hoy = reloj().atZone(LIMA).toLocalDate()
        val locales = dao.recoleccionesEntre(inicio(hoy.minusDays(DIAS_HISTORIAL - 1L)), inicio(hoy.plusDays(1)))
        return armarHistorial(hoy, consultar { api().ultimosDias(bearer()) }, locales)
    }

    /** null = sin red o sin sesión vigente: la pantalla muestra lo del celular y lo explica. */
    private suspend fun <T> consultar(llamada: suspend () -> T): T? = try {
        llamar { llamada() }
    } catch (e: ErrorApp) {
        if (e.esTransitorio || e is ErrorApp.NoAutorizado) null else throw e
    }

    companion object {
        /** Hoy y los 6 días anteriores, igual que `DIAS_HISTORIAL` en backend/app/routers/acopiador.py. */
        const val DIAS_HISTORIAL = 7

        private val LIMA: ZoneId = ZoneId.of("America/Lima")

        private fun inicio(fecha: LocalDate) = fecha.atStartOfDay(LIMA).toInstant().toEpochMilli()

        /**
         * Junta lo del servidor con lo de Room para un día (en hora de Lima).
         *
         * Lo pendiente que el servidor ya tiene (el push llegó pero la respuesta se perdió y Room sigue
         * en PENDIENTE) se descarta por UUID: el id es el mismo a los dos lados, lo genera el celular.
         */
        fun armarDia(
            fecha: LocalDate,
            servidor: MiDiaDto?,
            locales: List<RecoleccionEntidad>,
            esHoy: Boolean,
        ): ResumenMiDia {
            val desde = inicio(fecha)
            val hasta = inicio(fecha.plusDays(1))
            val delDia = locales.filter { it.registradaEnMs in desde until hasta }
            val conocidas = servidor?.recolecciones?.map { it.recoleccionId.lowercase() }?.toSet() ?: emptySet()
            val pendientes = delDia.filter { it.estadoSync == EstadoSync.PENDIENTE && it.id.lowercase() !in conocidas }
            val rechazadas = delDia.filter { it.estadoSync == EstadoSync.RECHAZADO }

            return when {
                servidor != null -> ResumenMiDia(
                    fecha = fecha,
                    totalLitros = BigDecimal(servidor.totalLitros.toString()).add(suma(pendientes)).setScale(2, RoundingMode.HALF_UP),
                    nRecolecciones = servidor.nRecolecciones + pendientes.size,
                    servidor = servidor, pendientes = pendientes, rechazadas = rechazadas, sinSincronizar = false,
                )

                esHoy -> {
                    val validas = delDia.filter { it.estadoSync != EstadoSync.RECHAZADO }
                    ResumenMiDia(
                        fecha = fecha, totalLitros = suma(validas).setScale(2, RoundingMode.HALF_UP), nRecolecciones = validas.size,
                        servidor = null, pendientes = pendientes, rechazadas = rechazadas, sinSincronizar = true,
                    )
                }

                else -> ResumenMiDia(
                    fecha = fecha, totalLitros = BigDecimal.ZERO.setScale(2), nRecolecciones = 0,
                    servidor = null, pendientes = pendientes, rechazadas = rechazadas, sinSincronizar = true,
                    sinTotal = true,
                )
            }
        }

        /** Un día por fecha, de hoy hacia atrás. Un día que el servidor no mande cuenta como vacío. */
        fun armarHistorial(hoy: LocalDate, servidor: List<MiDiaDto>?, locales: List<RecoleccionEntidad>): HistorialDias {
            val porFecha = servidor?.associateBy { it.fecha }
            val dias = (0 until DIAS_HISTORIAL).map { i ->
                val fecha = hoy.minusDays(i.toLong())
                val delServidor = porFecha?.let { it[fecha.toString()] ?: MiDiaDto(fecha.toString(), 0.0, 0) }
                armarDia(fecha, delServidor, locales, esHoy = i == 0)
            }
            return HistorialDias(dias, sinConexion = servidor == null)
        }

        private fun suma(rs: List<RecoleccionEntidad>) = rs.fold(BigDecimal.ZERO) { s, r -> s + BigDecimal(r.litros) }
    }
}
