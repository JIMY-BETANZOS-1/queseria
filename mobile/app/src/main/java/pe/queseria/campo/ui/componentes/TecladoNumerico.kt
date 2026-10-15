package pe.queseria.campo.ui.componentes

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** Orden fijo del teclado: 1-2-3 arriba (como en un celular) y el 0 en la última fila. */
internal val ORDEN_FIJO: List<Int> = listOf(1, 2, 3, 4, 5, 6, 7, 8, 9, 0)

/**
 * Los diez dígitos en el orden en que se dibujan.
 *
 * Barajados **solo** para el PIN (B2), donde el orden fijo delataría el PIN por la posición de los
 * dedos (`docs/pantallas.md`, B2). Para los litros (B4) van en orden fijo: el acopiador teclea rápido
 * y casi a ciegas, y un teclado que cambia de orden hace equivocarse con la leche.
 */
internal fun digitosTeclado(mezclar: Boolean): List<Int> =
    if (mezclar) (0..9).shuffled() else ORDEN_FIJO

/**
 * Teclado numérico propio: botones grandes y de alto contraste, pensados para usarse al aire libre y
 * con las manos ocupadas. No depende del teclado del sistema, que taparía la pantalla y cambia de
 * tamaño en cada celular.
 *
 * Un solo componente para las dos pantallas que lo usan:
 *  - **B4 (litros)**: `mezclar = false` y [onPunto] → última fila `.` `0` `⌫`.
 *  - **B2 (PIN)**: `mezclar = true` y [onOk] → última fila `⌫` `<dígito>` `OK`.
 *
 * @param mezclar baraja los dígitos (solo el PIN).
 * @param claveMezcla cuando cambia, se vuelve a barajar (B2 remezcla en cada etapa del cambio de
 *   PIN). Con el orden fijo no tiene efecto.
 */
@Composable
fun TecladoNumerico(
    onDigito: (Char) -> Unit,
    onBorrar: () -> Unit,
    modifier: Modifier = Modifier,
    habilitado: Boolean = true,
    mezclar: Boolean = false,
    claveMezcla: Any? = Unit,
    onPunto: (() -> Unit)? = null,
    onOk: (() -> Unit)? = null,
) {
    val digitos = remember(mezclar, claveMezcla) { digitosTeclado(mezclar) }
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf(0..2, 3..5, 6..8).forEach { rango ->
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                rango.forEach { i -> Digito(digitos[i], habilitado, onDigito) }
            }
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (onOk != null) {
                Borrar(habilitado, onBorrar)
                Digito(digitos[9], habilitado, onDigito)
                Button(onClick = onOk, enabled = habilitado, modifier = Modifier.weight(1f).height(ALTO)) {
                    Text("OK", style = MaterialTheme.typography.titleLarge)
                }
            } else {
                if (onPunto != null) Tecla(".", habilitado, onPunto) else Hueco()
                Digito(digitos[9], habilitado, onDigito)
                Borrar(habilitado, onBorrar)
            }
        }
    }
}

@Composable
private fun RowScope.Digito(digito: Int, habilitado: Boolean, onDigito: (Char) -> Unit) =
    Tecla(digito.toString(), habilitado) { onDigito('0' + digito) }

@Composable
private fun RowScope.Tecla(texto: String, habilitado: Boolean, onClick: () -> Unit) {
    FilledTonalButton(
        onClick = onClick,
        enabled = habilitado,
        modifier = Modifier.weight(1f).height(ALTO),
    ) {
        Text(texto, style = MaterialTheme.typography.headlineSmall)
    }
}

@Composable
private fun RowScope.Borrar(habilitado: Boolean, onBorrar: () -> Unit) {
    OutlinedButton(
        onClick = onBorrar,
        enabled = habilitado,
        modifier = Modifier.weight(1f).height(ALTO),
    ) {
        Text("⌫", style = MaterialTheme.typography.headlineSmall)
    }
}

/** Hueco del tamaño de una tecla, para que el 0 quede centrado si no hay punto decimal. */
@Composable
private fun RowScope.Hueco() = Spacer(Modifier.weight(1f).height(ALTO))

private val ALTO = 60.dp
