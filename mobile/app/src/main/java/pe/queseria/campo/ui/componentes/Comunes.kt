package pe.queseria.campo.ui.componentes

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun MensajeError(texto: String, modifier: Modifier = Modifier) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
        modifier = modifier.fillMaxWidth(),
    ) {
        Text(
            texto,
            color = MaterialTheme.colorScheme.onErrorContainer,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(12.dp),
        )
    }
}

/** Aviso informativo (no es un error): por ejemplo que quedan recolecciones sin enviar. */
@Composable
fun MensajeAviso(texto: String, modifier: Modifier = Modifier) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
        modifier = modifier.fillMaxWidth(),
    ) {
        Text(
            texto,
            color = MaterialTheme.colorScheme.onSecondaryContainer,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(12.dp),
        )
    }
}

/**
 * Botones de campo: 56 dp como mínimo, no una altura fija. Con una altura fija una etiqueta que no
 * cabía en una línea se partía y el botón la recortaba; así el botón crece con ella.
 */
@Composable
fun BtnPrimario(
    texto: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    habilitado: Boolean = true,
    cargando: Boolean = false,
) {
    Button(
        onClick = onClick,
        enabled = habilitado && !cargando,
        modifier = modifier.fillMaxWidth().heightIn(min = 56.dp),
    ) {
        if (cargando) {
            CircularProgressIndicator(
                modifier = Modifier.size(20.dp),
                strokeWidth = 2.dp,
                color = MaterialTheme.colorScheme.onPrimary,
            )
        } else {
            Text(texto, style = MaterialTheme.typography.titleMedium)
        }
    }
}

@Composable
fun BtnSecundario(
    texto: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    habilitado: Boolean = true,
) {
    Button(
        onClick = onClick,
        enabled = habilitado,
        colors = ButtonDefaults.outlinedButtonColors(),
        modifier = modifier.fillMaxWidth().heightIn(min = 56.dp),
    ) {
        Text(texto, style = MaterialTheme.typography.titleMedium)
    }
}
