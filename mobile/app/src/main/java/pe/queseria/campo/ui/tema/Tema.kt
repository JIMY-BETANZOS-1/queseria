package pe.queseria.campo.ui.tema

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val colores = lightColorScheme(
    primary          = Color(0xFF1565C0),
    onPrimary        = Color.White,
    primaryContainer = Color(0xFFBBDEFB),
    error            = Color(0xFFB71C1C),
    onError          = Color.White,
    errorContainer   = Color(0xFFFFCDD2),
    onErrorContainer = Color(0xFF7F0000),
)

@Composable
fun TemaCampo(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = colores, content = content)
}
