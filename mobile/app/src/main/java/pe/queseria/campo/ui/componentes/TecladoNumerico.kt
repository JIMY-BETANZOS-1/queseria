package pe.queseria.campo.ui.componentes

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * Teclado numérico propio para los litros (B4): botones grandes y de alto contraste, pensados para
 * usarse al aire libre y con las manos ocupadas. No depende del teclado del sistema, que taparía la
 * pantalla y cambia de tamaño en cada celular.
 */
@Composable
fun TecladoNumerico(
    onDigito: (Char) -> Unit,
    onPunto: () -> Unit,
    onBorrar: () -> Unit,
    modifier: Modifier = Modifier,
    habilitado: Boolean = true,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf("789", "456", "123").forEach { fila ->
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                fila.forEach { d ->
                    TeclaTonal(d.toString(), habilitado, Modifier.weight(1f)) { onDigito(d) }
                }
            }
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TeclaTonal(".", habilitado, Modifier.weight(1f), onPunto)
            TeclaTonal("0", habilitado, Modifier.weight(1f)) { onDigito('0') }
            OutlinedButton(
                onClick = onBorrar,
                enabled = habilitado,
                modifier = Modifier.weight(1f).height(ALTO),
            ) {
                Text("⌫", style = MaterialTheme.typography.headlineSmall)
            }
        }
    }
}

@Composable
private fun TeclaTonal(texto: String, habilitado: Boolean, modifier: Modifier, onClick: () -> Unit) {
    FilledTonalButton(
        onClick = onClick,
        enabled = habilitado,
        modifier = modifier.height(ALTO),
    ) {
        Text(texto, style = MaterialTheme.typography.headlineSmall)
    }
}

private val ALTO = 60.dp
