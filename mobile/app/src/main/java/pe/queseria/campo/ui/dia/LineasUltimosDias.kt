package pe.queseria.campo.ui.dia

import pe.queseria.campo.sync.HistorialDias
import pe.queseria.campo.ui.inicio.Insignia
import pe.queseria.campo.ui.sync.TextosSync
import java.time.LocalDate

/**
 * Una fila de "Últimos días" (B6b).
 *
 * [total] = "142.00 L · 8 entregas", "Sin entregas" o "Sin conexión". [marcas] = lo que este celular
 * todavía no envió (ámbar) o el servidor rechazó (rojo) ese día; así lo del celular no se confunde con
 * lo que ya está en el servidor.
 */
data class FilaDia(val fecha: LocalDate, val esHoy: Boolean, val titulo: String, val total: String, val marcas: List<Insignia>)

/** Textos de B6b, sin Android ni Compose para poder probarlos. */
object LineasUltimosDias {

    fun filas(h: HistorialDias): List<FilaDia> = h.dias.mapIndexed { i, r ->
        val esHoy = i == 0
        FilaDia(
            fecha = r.fecha,
            esHoy = esHoy,
            titulo = if (esHoy) "Hoy" else LineasMiDia.fechaLarga(r.fecha),
            total = if (!r.sinTotal && r.nRecolecciones == 0) "Sin entregas" else LineasMiDia.total(r),
            marcas = buildList {
                val p = r.pendientes.size
                val x = r.rechazadas.size
                if (p > 0) add(Insignia("$p sin enviar", TextosSync.Tono.ADVERTENCIA))
                if (x > 0) add(Insignia(if (x == 1) "1 rechazada" else "$x rechazadas", TextosSync.Tono.ERROR))
            },
        )
    }

    /** Aviso de arriba sin red: hoy sí tiene total (el del celular); los días anteriores, no. */
    const val AVISO_SIN_CONEXION =
        "⚠ Sin conexión: los totales de días anteriores se ven con señal. Lo que falta enviar sí aparece."
}
