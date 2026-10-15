package pe.queseria.campo.ui

import pe.queseria.campo.datos.local.ProductorFila
import pe.queseria.campo.ui.inicio.ResumenProductor

/**
 * Pantallas del acopiador una vez abierta la sesión. Son pocas y el paso entre ellas es lineal, así
 * que se resuelve con un estado guardado en lugar de añadir una librería de navegación.
 */
sealed class Destino {
    /**
     * B3.
     *
     * [aviso] = confirmación que deja B4 al volver ("✓ Registrado: 23.50 L · Juana Mamani").
     * [confirmar] = clave del productor que ya entregó hoy y espera el "¿Otra entrega?". Vive en el
     * destino, y no en un `remember` de la pantalla, para que el aviso y la navegación sean **un
     * solo estado**: al confirmar se pasa a [Registrar] con una única escritura.
     */
    data class Inicio(val aviso: String? = null, val confirmar: String? = null) : Destino()

    /** B4 para el productor [claveProductor]. */
    data class Registrar(val claveProductor: String) : Destino()
}

/**
 * Decisiones de navegación del acopiador (lógica pura, sin Android ni Compose, para poder probarla).
 *
 * Están aquí y no repartidas en las pantallas porque el fallo que arreglaron era justamente de
 * estado: la confirmación de "otra entrega" se guardaba aparte del destino, el "Sí" escribía dos
 * estados en el mismo fotograma (cerrar el diálogo + navegar) y el gesto atrás que el diálogo le
 * entregaba a la actividad —con el `BackHandler` recién habilitado— devolvía a B3 antes de que B4
 * terminara de entrar.
 */
object Rumbo {

    /** Toque en una fila de B3: si ya entregó hoy se confirma primero; si no, se abre B4 directo. */
    fun alTocarProductor(fila: ProductorFila): Destino =
        if (ResumenProductor.pideConfirmarOtraEntrega(fila)) Destino.Inicio(confirmar = fila.clave)
        else Destino.Registrar(fila.clave)

    /** "Sí, otra entrega": abre B4 con el productor del aviso. Una sola escritura de estado. */
    fun alConfirmarOtraEntrega(destino: Destino): Destino =
        (destino as? Destino.Inicio)?.confirmar?.let { Destino.Registrar(it) } ?: destino

    /** "Cancelar" en el aviso: se queda en B3 y se cierra el aviso. */
    fun alCancelarConfirmacion(destino: Destino): Destino =
        (destino as? Destino.Inicio)?.copy(confirmar = null) ?: destino

    /**
     * Botón o gesto atrás: cierra el aviso de confirmación, o vuelve de B4 a B3.
     * `null` = no hay nada que hacer (que el sistema salga de la app).
     *
     * Importante: mientras el aviso está abierto esto ya devuelve algo, así que el `BackHandler`
     * sigue habilitado al pasar a B4 y no hay un salto deshabilitado → habilitado que haga que un
     * atrás pendiente se cuele justo al entrar a la pantalla.
     */
    fun atras(destino: Destino): Destino? = when {
        destino is Destino.Inicio && destino.confirmar != null -> destino.copy(confirmar = null)
        destino is Destino.Registrar -> Destino.Inicio()
        else -> null
    }
}
