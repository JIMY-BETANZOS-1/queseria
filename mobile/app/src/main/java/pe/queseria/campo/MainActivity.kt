package pe.queseria.campo

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import pe.queseria.campo.seguridad.EstadoSesion

/** Fase 3A: solo muestra el estado de la sesión. Las pantallas del acopiador llegan en 3B. */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val contenedor = (application as QueseriaApp).contenedor
        setContent {
            MaterialTheme {
                Surface(Modifier.fillMaxSize()) {
                    val estado by contenedor.autenticador.estado.collectAsStateWithLifecycle()
                    Column(Modifier.padding(24.dp)) {
                        Text("Quesería Campo", style = MaterialTheme.typography.headlineMedium)
                        Text(
                            when (val e = estado) {
                                EstadoSesion.SinVincular -> "Celular sin vincular"
                                is EstadoSesion.Cerrada -> "Vinculado a ${e.usuario.nombre}. Ingrese su PIN"
                                is EstadoSesion.Abierta -> "Sesión abierta: ${e.usuario.nombre}"
                            },
                            style = MaterialTheme.typography.titleLarge,
                        )
                    }
                }
            }
        }
    }
}
