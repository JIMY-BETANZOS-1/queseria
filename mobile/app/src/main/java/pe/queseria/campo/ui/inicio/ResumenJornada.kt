package pe.queseria.campo.ui.inicio

import pe.queseria.campo.datos.local.ProductorFila
import pe.queseria.campo.ui.sync.TextosSync
import java.math.BigDecimal
import java.math.RoundingMode

/** Cómo va la jornada, para la tarjeta de arriba de B3. */
data class Jornada(val litros: BigDecimal, val entregas: Int, val atendidos: Int, val productores: Int)

/** Pastilla de sincronización de la tarjeta de B3. */
data class Insignia(val texto: String, val tono: TextosSync.Tono)

/**
 * Tarjeta de la jornada (B3). Lógica pura, sin Android, para poder probarla.
 *
 * Sale de las mismas filas de la lista, ya fusionadas con lo que dijo el servidor
 * ([RehidratarDia.fusionar]): así la tarjeta y la lista nunca se contradicen.
 */
object ResumenJornada {

    fun de(filas: List<ProductorFila>): Jornada = Jornada(
        litros = filas.fold(BigDecimal.ZERO) { s, f -> s + BigDecimal(f.litrosHoy.toString()) }
            .setScale(2, RoundingMode.HALF_UP),
        entregas = filas.sumOf { it.nHoy },
        atendidos = filas.count { it.nHoy > 0 },
        productores = filas.size,
    )

    /** "128.50 L". */
    fun textoLitros(j: Jornada): String = "${j.litros.toPlainString()} L"

    /** "1 entrega" / "7 entregas". */
    fun textoEntregas(j: Jornada): String = ResumenProductor.entregas(j.entregas)

    /** "5 de 12 productores atendidos" / "0 de 1 productor atendido". */
    fun textoAtendidos(j: Jornada): String =
        if (j.productores == 1) "${j.atendidos} de 1 productor atendido"
        else "${j.atendidos} de ${j.productores} productores atendidos"

    /**
     * Lo que falta enviar y lo rechazado que todavía no se avisó al administrador. Lo rechazado manda
     * el color: lo pendiente se envía solo cuando hay señal, lo rechazado necesita que el acopiador avise.
     */
    fun insignia(pendientes: Int, rechazadas: Int, conServidor: Boolean): Insignia {
        val partes = buildList {
            if (pendientes > 0) add(if (conServidor) "$pendientes sin enviar" else "Sin señal · $pendientes sin enviar")
            if (rechazadas > 0) add(if (rechazadas == 1) "1 rechazada" else "$rechazadas rechazadas")
        }
        return when {
            partes.isEmpty() -> Insignia("✓ Todo enviado", TextosSync.Tono.BIEN)
            rechazadas > 0 -> Insignia(partes.joinToString(" · "), TextosSync.Tono.ERROR)
            else -> Insignia(partes.joinToString(" · "), TextosSync.Tono.ADVERTENCIA)
        }
    }
}
