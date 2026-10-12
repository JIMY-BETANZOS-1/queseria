package pe.queseria.campo

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import pe.queseria.campo.seguridad.EstadoSesion
import pe.queseria.campo.ui.activar.ActivarPantalla
import pe.queseria.campo.ui.pin.PinPantalla
import pe.queseria.campo.ui.tema.TemaCampo

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val contenedor = (application as QueseriaApp).contenedor
        setContent {
            TemaCampo {
                Surface(
                    modifier = Modifier.fillMaxSize().safeDrawingPadding(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    val sesion by contenedor.autenticador.estado.collectAsStateWithLifecycle()
                    when (val s = sesion) {
                        EstadoSesion.SinVincular ->
                            ActivarPantalla(contenedor.autenticador)

                        is EstadoSesion.Cerrada ->
                            PinPantalla(contenedor.autenticador, debeCambiarPin = false)

                        is EstadoSesion.Abierta ->
                            if (s.debeCambiarPin) {
                                PinPantalla(contenedor.autenticador, debeCambiarPin = true)
                            } else {
                                // Placeholder hasta que se apruebe la fase 3B completa
                                Column(Modifier.padding(24.dp)) {
                                    Text("Bienvenido, ${s.usuario.nombre}",
                                         style = MaterialTheme.typography.headlineMedium)
                                    Spacer(Modifier.height(8.dp))
                                    Text("Pantallas del acopiador próximamente",
                                         style = MaterialTheme.typography.bodyLarge)
                                    if (!s.conServidor) {
                                        Spacer(Modifier.height(8.dp))
                                        Text("⚠ Sin señal — ingresaste sin conexión",
                                             style = MaterialTheme.typography.bodyMedium,
                                             color = MaterialTheme.colorScheme.error)
                                    }
                                }
                            }
                    }
                }
            }
        }
    }
}
