package pe.queseria.campo.ui.dia

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import pe.queseria.campo.sync.HistorialDias
import pe.queseria.campo.sync.MiDia
import pe.queseria.campo.ui.componentes.BtnPrimario
import pe.queseria.campo.ui.componentes.BtnSecundario
import pe.queseria.campo.ui.componentes.MensajeAviso
import pe.queseria.campo.ui.componentes.MensajeError
import pe.queseria.campo.ui.inicio.Insignia
import pe.queseria.campo.ui.sync.TextosSync
import pe.queseria.campo.ui.tema.ColorAdvertencia
import java.time.LocalDate

// ─── ViewModel ───────────────────────────────────────────────────────────────

sealed class EstadoUltimosDias {
    data object Cargando : EstadoUltimosDias()
    data class Ok(val historial: HistorialDias) : EstadoUltimosDias()
    data class Error(val mensaje: String) : EstadoUltimosDias()
}

class UltimosDiasViewModel(private val miDia: MiDia) : ViewModel() {

    private val _estado = MutableStateFlow<EstadoUltimosDias>(EstadoUltimosDias.Cargando)
    val estado: StateFlow<EstadoUltimosDias> = _estado.asStateFlow()

    /** Igual que en B6: la falta de red no es un error, la devuelve [MiDia.ultimosDias] como `sinConexion`. */
    fun actualizar() {
        viewModelScope.launch {
            _estado.value = EstadoUltimosDias.Cargando
            _estado.value = try {
                EstadoUltimosDias.Ok(miDia.ultimosDias())
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                EstadoUltimosDias.Error(e.message ?: "No se pudieron armar los últimos días")
            }
        }
    }

    companion object {
        fun factory(miDia: MiDia) = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>) = UltimosDiasViewModel(miDia) as T
        }
    }
}

// ─── B6b: últimos días ───────────────────────────────────────────────────────

@Composable
fun UltimosDiasPantalla(miDia: MiDia, onAbrirDia: (fecha: LocalDate, esHoy: Boolean) -> Unit, onVolver: () -> Unit) {
    val vm: UltimosDiasViewModel = viewModel(factory = UltimosDiasViewModel.factory(miDia))
    val estado by vm.estado.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { vm.actualizar() }

    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Últimos días", style = MaterialTheme.typography.headlineSmall)

        // Zona de contenido acotada: así los botones quedan siempre a la vista
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            when (val e = estado) {
                EstadoUltimosDias.Cargando -> Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp),
                    horizontalArrangement = Arrangement.Center,
                ) {
                    CircularProgressIndicator()
                }

                is EstadoUltimosDias.Error -> MensajeError(e.mensaje)

                is EstadoUltimosDias.Ok -> {
                    if (e.historial.sinConexion) MensajeAviso(LineasUltimosDias.AVISO_SIN_CONEXION)
                    LazyColumn(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        items(LineasUltimosDias.filas(e.historial), key = { it.fecha.toString() }) { f ->
                            FilaDelDia(f, onClick = { onAbrirDia(f.fecha, f.esHoy) })
                        }
                    }
                }
            }
        }

        BtnPrimario(
            texto = "ACTUALIZAR",
            onClick = vm::actualizar,
            cargando = estado is EstadoUltimosDias.Cargando,
        )
        BtnSecundario(texto = "Volver", onClick = onVolver)
    }
}

@Composable
private fun FilaDelDia(f: FilaDia, onClick: () -> Unit) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (f.esHoy) MaterialTheme.colorScheme.primaryContainer
            else MaterialTheme.colorScheme.surfaceVariant,
        ),
        modifier = Modifier.fillMaxWidth().heightIn(min = 72.dp).clickable(onClick = onClick),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    f.titulo,
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
                Text("›", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(f.total, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            if (f.marcas.isNotEmpty()) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    f.marcas.forEach { Marca(it) }
                }
            }
        }
    }
}

@Composable
private fun Marca(m: Insignia) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = when (m.tono) {
            TextosSync.Tono.BIEN -> MaterialTheme.colorScheme.primary
            TextosSync.Tono.ADVERTENCIA -> ColorAdvertencia
            TextosSync.Tono.ERROR -> MaterialTheme.colorScheme.error
        },
        contentColor = Color.White,
    ) {
        Text(
            m.texto,
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
        )
    }
}
