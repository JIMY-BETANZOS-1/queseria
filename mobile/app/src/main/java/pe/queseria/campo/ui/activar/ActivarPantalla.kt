package pe.queseria.campo.ui.activar

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import pe.queseria.campo.datos.remoto.ErrorApp
import pe.queseria.campo.seguridad.Autenticador
import pe.queseria.campo.ui.componentes.BtnPrimario
import pe.queseria.campo.ui.componentes.MensajeError

// ─── ViewModel ───────────────────────────────────────────────────────────────

sealed class EstadoActivar {
    data object Idle : EstadoActivar()
    data object Cargando : EstadoActivar()
    data class Error(val mensaje: String) : EstadoActivar()
}

class ActivarViewModel(private val autenticador: Autenticador) : ViewModel() {

    private val _estado = MutableStateFlow<EstadoActivar>(EstadoActivar.Idle)
    val estado: StateFlow<EstadoActivar> = _estado.asStateFlow()

    fun activar(codigo: String) {
        viewModelScope.launch {
            _estado.value = EstadoActivar.Cargando
            try {
                autenticador.activar(codigo)
                // Autenticador emite EstadoSesion.Cerrada; MainActivity detecta el cambio
            } catch (e: ErrorApp) {
                _estado.value = EstadoActivar.Error(e.message ?: "Error al vincular el celular")
            } catch (e: Exception) {
                _estado.value = EstadoActivar.Error("Error inesperado: ${e.message}")
            }
        }
    }

    fun limpiarError() { if (_estado.value is EstadoActivar.Error) _estado.value = EstadoActivar.Idle }

    companion object {
        fun factory(autenticador: Autenticador) = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>) =
                ActivarViewModel(autenticador) as T
        }
    }
}

// ─── Pantalla ─────────────────────────────────────────────────────────────────

@Composable
fun ActivarPantalla(autenticador: Autenticador) {
    val vm: ActivarViewModel = viewModel(factory = ActivarViewModel.factory(autenticador))
    val estado by vm.estado.collectAsStateWithLifecycle()
    var codigo by remember { mutableStateOf("") }

    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Quesería Campo", style = MaterialTheme.typography.titleSmall,
             color = MaterialTheme.colorScheme.primary)
        Text("Vincular celular", style = MaterialTheme.typography.headlineMedium)
        Text(
            "Ingrese el código de 8 caracteres que le entregó el administrador.",
            style = MaterialTheme.typography.bodyLarge,
        )

        OutlinedTextField(
            value = codigo,
            onValueChange = {
                codigo = it.uppercase().filter { c -> c.isLetterOrDigit() }.take(8)
                vm.limpiarError()
            },
            label = { Text("Código de activación") },
            placeholder = { Text("XXXXXXXX") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.Characters,
                imeAction = ImeAction.Done,
            ),
            modifier = Modifier.fillMaxWidth(),
        )

        if (estado is EstadoActivar.Error) {
            MensajeError((estado as EstadoActivar.Error).mensaje)
        }

        Spacer(Modifier.weight(1f))

        BtnPrimario(
            texto = "Vincular",
            onClick = { vm.activar(codigo) },
            cargando = estado is EstadoActivar.Cargando,
            habilitado = codigo.length == 8 && estado !is EstadoActivar.Cargando,
        )
    }
}
