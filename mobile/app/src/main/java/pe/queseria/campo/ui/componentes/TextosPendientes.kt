package pe.queseria.campo.ui.componentes

/**
 * Cuánto queda sin enviar, contando las dos cosas que viven en la cola: las recolecciones y las altas
 * de productor hechas en el campo. Las usan B1 (aviso antes de revincular), B3 (barra) y B7.
 *
 * Un alta sin subir no es un detalle: si el celular se reinstala se pierde, y con ella la leche que la
 * apunta por `uuid_cliente`. Por eso cuenta como "sin enviar" igual que una recolección.
 */
object TextosPendientes {

    /** "2 entregas y 1 productor"; null si no hay nada pendiente. */
    fun contar(entregas: Int, productores: Int): String? {
        val partes = buildList {
            if (entregas > 0) add(if (entregas == 1) "1 entrega" else "$entregas entregas")
            if (productores > 0) add(if (productores == 1) "1 productor" else "$productores productores")
        }
        return partes.takeIf { it.isNotEmpty() }?.joinToString(" y ")
    }

    /** Estado de B7: "Todo enviado" o "2 entregas y 1 productor sin enviar". */
    fun estado(entregas: Int, productores: Int): String =
        contar(entregas, productores)?.let { "$it sin enviar" } ?: "Todo enviado"
}
