package pe.queseria.campo.ui.dia

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import pe.queseria.campo.sync.MiDia
import pe.queseria.campo.sync.ResumenMiDia
import pe.queseria.campo.ui.componentes.BtnPrimario
import pe.queseria.campo.ui.componentes.BtnSecundario
import pe.queseria.campo.ui.componentes.MensajeAviso
import pe.queseria.campo.ui.componentes.MensajeError
import pe.queseria.campo.ui.tema.ColorAdvertencia
import java.time.LocalDate

// ─── ViewModel ───────────────────────────────────────────────────────────────

sealed class EstadoMiDia {
    data object Cargando : EstadoMiDia()
    data class Ok(val resumen: ResumenMiDia) : EstadoMiDia()
    data class Error(val mensaje: String) : EstadoMiDia()
}

/** [fecha] = null: hoy, en vivo (GET /acopiador/mi-dia). Otra fecha: un día de "Últimos días". */
class MiDiaViewModel(private val miDia: MiDia, private val fecha: LocalDate?) : ViewModel() {

    private val _estado = MutableStateFlow<EstadoMiDia>(EstadoMiDia.Cargando)
    val estado: StateFlow<EstadoMiDia> = _estado.asStateFlow()

    /**
     * [MiDia.obtener] ya traga los errores de red y devuelve `sinSincronizar = true`, así que un Error
     * aquí es algo que el acopiador no puede resolver solo (la base local, por ejemplo).
     */
    fun actualizar() {
        viewModelScope.launch {
            _estado.value = EstadoMiDia.Cargando
            _estado.value = try {
                if (fecha == null) {
                    EstadoMiDia.Ok(miDia.obtener())
                } else {
                    // Pasada la medianoche, el día más viejo sale de la ventana: se dice y no se inventa
                    miDia.ultimosDias().dias.firstOrNull { it.fecha == fecha }?.let { EstadoMiDia.Ok(it) }
                        ?: EstadoMiDia.Error("Ese día ya no está entre los últimos ${MiDia.DIAS_HISTORIAL} días.")
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                EstadoMiDia.Error(e.message ?: "No se pudo armar el resumen del día")
            }
        }
    }

    companion object {
        fun factory(miDia: MiDia, fecha: LocalDate?) = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>) = MiDiaViewModel(miDia, fecha) as T
        }
    }
}

// ─── B6: mi día (o un día anterior, desde B6b) ───────────────────────────────

/**
 * @param fecha null = hoy. Con fecha, el mismo detalle para un día de "Últimos días".
 * @param onDiasAnteriores solo en hoy: abre B6b.
 */
@Composable
fun MiDiaPantalla(
    miDia: MiDia,
    onVolver: () -> Unit,
    fecha: LocalDate? = null,
    onDiasAnteriores: (() -> Unit)? = null,
) {
    // Sin NavHost los ViewModel los guarda la actividad: uno por fecha, para no mostrar el día equivocado
    val vm: MiDiaViewModel = viewModel(key = "mi-dia-${fecha ?: "hoy"}", factory = MiDiaViewModel.factory(miDia, fecha))
    val estado by vm.estado.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { vm.actualizar() }

    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(if (fecha == null) "Mi día" else "Día anterior", style = MaterialTheme.typography.headlineSmall)

        // Zona de contenido acotada: así los botones quedan siempre a la vista, por larga que sea la lista
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            when (val e = estado) {
                EstadoMiDia.Cargando -> Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp),
                    horizontalArrangement = Arrangement.Center,
                ) {
                    CircularProgressIndicator()
                }

                is EstadoMiDia.Error -> MensajeError(e.mensaje)

                is EstadoMiDia.Ok -> Resumen(e.resumen, esHoy = fecha == null)
            }
        }

        BtnPrimario(
            texto = "ACTUALIZAR",
            onClick = vm::actualizar,
            cargando = estado is EstadoMiDia.Cargando,
        )
        onDiasAnteriores?.let { BtnSecundario(texto = "Ver días anteriores ›", onClick = it) }
        BtnSecundario(texto = "Volver", onClick = onVolver)
    }
}

@Composable
private fun ColumnScope.Resumen(r: ResumenMiDia, esHoy: Boolean) {
    val lineas = LineasMiDia.lineas(r)

    Text(LineasMiDia.fechaLarga(r.fecha), style = MaterialTheme.typography.titleMedium)
    Text(
        LineasMiDia.total(r),
        style = MaterialTheme.typography.headlineMedium,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.primary,
    )
    LineasMiDia.incluyeSinEnviar(r)?.let {
        Text(it, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = ColorAdvertencia)
    }

    if (r.sinTotal) {
        MensajeAviso("⚠ Sin conexión: solo se ve lo que este celular aún no envió. El total del día está en el servidor.")
    } else if (r.sinSincronizar) {
        MensajeAviso("⚠ Sin conexión: el total es solo lo de este celular.")
    }
    if (r.rechazadas.isNotEmpty()) {
        MensajeError(
            "Hay ${r.rechazadas.size} entrega(s) que el servidor rechazó: no suman. " +
                "Vea el motivo en Sincronización y avise al administrador.",
        )
    }

    if (lineas.isEmpty()) {
        Text(
            LineasMiDia.sinEntregas(r, esHoy),
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.padding(top = 8.dp),
        )
    } else {
        LazyColumn(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(lineas, key = { it.id }) { Fila(it) }
        }
    }
}

@Composable
private fun Fila(l: LineaDia) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (l.problema) MaterialTheme.colorScheme.errorContainer
            else MaterialTheme.colorScheme.surfaceVariant,
        ),
        modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                l.hora,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    l.productor,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = if (l.problema) MaterialTheme.colorScheme.error
                    else MaterialTheme.colorScheme.onSurface,
                )
                l.etiqueta?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.labelLarge,
                        color = if (l.problema) MaterialTheme.colorScheme.error
                        else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Text(
                "${l.litros} L",
                style = MaterialTheme.typography.titleLarge,
                color = if (l.suma) MaterialTheme.colorScheme.primary
                else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
