package pe.queseria.campo

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import pe.queseria.campo.seguridad.EstadoSesion
import pe.queseria.campo.ui.AppAcopiador
import pe.queseria.campo.ui.analista.AppAnalista
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
                        is EstadoSesion.SinVincular -> {
                            // Lo sin sincronizar sobrevive al desvinculado: se avisa, no se borra.
                            // Las altas de productor cuentan igual que las entregas.
                            val dao = contenedor.base.syncDao()
                            val entregas by dao.observarPendientes()
                                .collectAsStateWithLifecycle(initialValue = 0)
                            val productores by dao.observarProductoresPendientes()
                                .collectAsStateWithLifecycle(initialValue = 0)
                            ActivarPantalla(
                                contenedor.autenticador, s.motivo, entregas, productores,
                                onVolver = if (s.puedeVolver) contenedor.autenticador::volverAlPin else null,
                            )
                        }

                        is EstadoSesion.Cerrada -> PinPantalla(contenedor.autenticador)

                        // El PIN lo crea el propio usuario al activar: ya no hay cambio obligatorio (B2b)
                        is EstadoSesion.Abierta -> if (s.usuario.rol == "analista") {
                            AppAnalista(contenedor, s.usuario.nombre)
                        } else {
                            AppAcopiador(contenedor, s)
                        }
                    }
                }
            }
        }
    }
}
