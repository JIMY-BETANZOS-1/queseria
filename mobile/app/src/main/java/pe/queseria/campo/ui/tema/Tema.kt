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

/**
 * Advertencia: algo que el acopiador debe atender pero que no es un error suyo (p. ej. se envió todo,
 * con rechazos). Material 3 no trae este rol. Ámbar oscuro: contraste ≥ 4.5 sobre blanco, legible al sol.
 */
val ColorAdvertencia = Color(0xFFB45309)

@Composable
fun TemaCampo(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = colores, content = content)
}
