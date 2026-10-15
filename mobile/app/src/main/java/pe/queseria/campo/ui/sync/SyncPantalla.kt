package pe.queseria.campo.ui.sync

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import pe.queseria.campo.BuildConfig
import pe.queseria.campo.datos.local.EntregaRetenidaFila
import pe.queseria.campo.datos.local.Meta
import pe.queseria.campo.datos.local.ProductorEntidad
import pe.queseria.campo.datos.local.RecoleccionEntidad
import pe.queseria.campo.datos.local.SyncDao
import pe.queseria.campo.datos.remoto.ErrorApp
import pe.queseria.campo.sync.MotorSync
import pe.queseria.campo.sync.ResumenSync
import pe.queseria.campo.sync.SyncWorker
import pe.queseria.campo.ui.componentes.BtnPrimario
import pe.queseria.campo.ui.componentes.BtnSecundario
import pe.queseria.campo.ui.componentes.MensajeAviso
import pe.queseria.campo.ui.componentes.MensajeError

// ─── ViewModel ───────────────────────────────────────────────────────────────

sealed class EstadoSincronizacion {
    /** [resumen] = lo que consiguió la última sincronización hecha desde esta pantalla. */
    data class Listo(val resumen: ResumenSync? = null) : EstadoSincronizacion()
    data object Sincronizando : EstadoSincronizacion()
    data class Error(val mensaje: String, val seReintentara: Boolean) : EstadoSincronizacion()
}

class SyncViewModel(private val dao: SyncDao, private val motor: MotorSync) : ViewModel() {

    private val _estado = MutableStateFlow<EstadoSincronizacion>(EstadoSincronizacion.Listo())
    val estado: StateFlow<EstadoSincronizacion> = _estado.asStateFlow()

    val pendientes: StateFlow<Int> =
        dao.observarPendientes().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 0)

    val ultimoSyncMs: StateFlow<Long?> = dao.observarMeta(Meta.ULTIMO_SYNC_MS)
        .map { it?.toLongOrNull() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val ultimoError: StateFlow<String?> = dao.observarMeta(Meta.ULTIMO_ERROR_SYNC)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val retenidas: StateFlow<List<EntregaRetenidaFila>> = dao.observarEntregasRetenidas()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val rechazadas: StateFlow<List<RecoleccionEntidad>> = dao.observarRechazadas()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val productoresRechazados: StateFlow<List<ProductorEntidad>> = dao.observarProductoresRechazados()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    /**
     * Sincroniza en el momento, no por WorkManager: es la misma instancia de [MotorSync] que usa
     * [SyncWorker] (las dos salen de AppContainer), así que su mutex serializa ambas vías y aquí sí se
     * puede mostrar el resultado o el motivo del fallo. Si la falla es de red o del servidor, se encola
     * el worker para que reintente cuando vuelva la señal: nada queda a la espera de otro toque.
     */
    fun sincronizar(onEncolarReintento: () -> Unit) {
        if (_estado.value is EstadoSincronizacion.Sincronizando) return
        _estado.value = EstadoSincronizacion.Sincronizando
        viewModelScope.launch {
            _estado.value = try {
                EstadoSincronizacion.Listo(motor.sincronizar())
            } catch (e: ErrorApp) {
                if (e.esTransitorio) onEncolarReintento()
                EstadoSincronizacion.Error(
                    mensaje = e.message ?: "No se pudo sincronizar",
                    seReintentara = e.esTransitorio,
                )
            }
        }
    }

    companion object {
        fun factory(dao: SyncDao, motor: MotorSync) = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>) = SyncViewModel(dao, motor) as T
        }
    }
}

// ─── B7: sincronización ──────────────────────────────────────────────────────

@Composable
fun SyncPantalla(dao: SyncDao, motor: MotorSync, onVolver: () -> Unit) {
    val vm: SyncViewModel = viewModel(factory = SyncViewModel.factory(dao, motor))
    val estado by vm.estado.collectAsStateWithLifecycle()
    val pendientes by vm.pendientes.collectAsStateWithLifecycle()
    val ultimoSyncMs by vm.ultimoSyncMs.collectAsStateWithLifecycle()
    val ultimoError by vm.ultimoError.collectAsStateWithLifecycle()
    val retenidas by vm.retenidas.collectAsStateWithLifecycle()
    val rechazadas by vm.rechazadas.collectAsStateWithLifecycle()
    val productoresRechazados by vm.productoresRechazados.collectAsStateWithLifecycle()
    val context = LocalContext.current

    val sueltas = TextosSync.partirRechazadas(rechazadas, retenidas)

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Sincronización", style = MaterialTheme.typography.headlineSmall)

        Estado(
            pendientes = pendientes,
            ultimoSync = TextosSync.textoUltimoSync(ultimoSyncMs, System.currentTimeMillis()),
        )

        when (val e = estado) {
            // Sin resumen propio todavía, se muestra lo último que dejó el worker en segundo plano
            is EstadoSincronizacion.Listo ->
                if (e.resumen != null) {
                    MensajeAviso("✓ ${TextosSync.textoResumen(e.resumen)}")
                } else {
                    ultimoError?.let { MensajeAviso("Último intento: $it") }
                }

            is EstadoSincronizacion.Error -> MensajeError(
                if (e.seReintentara) "${e.mensaje}. Se reintentará solo cuando haya señal."
                else e.mensaje,
            )

            EstadoSincronizacion.Sincronizando -> Unit
        }

        BtnPrimario(
            texto = "SINCRONIZAR AHORA",
            onClick = { vm.sincronizar { SyncWorker.sincronizarAhora(context) } },
            cargando = estado is EstadoSincronizacion.Sincronizando,
        )

        if (retenidas.isNotEmpty()) {
            Seccion("Entrega retenida: su productor fue rechazado") {
                MensajeError(
                    "Esta leche ya se recibió y no se puede pasar a otro productor desde el celular. " +
                        "Repórtela al administrador con estos datos.",
                )
                retenidas.forEach { r ->
                    Problema(
                        titulo = TextosSync.textoRetenida(r),
                        motivo = r.motivoProductor ?: "El servidor rechazó el alta del productor",
                    )
                }
            }
        }

        if (productoresRechazados.isNotEmpty()) {
            Seccion("Altas de productor rechazadas") {
                productoresRechazados.forEach { p ->
                    Problema(titulo = p.nombre, motivo = p.motivo ?: "Sin motivo")
                }
            }
        }

        if (sueltas.isNotEmpty()) {
            Seccion("Entregas rechazadas") {
                sueltas.forEach { r ->
                    Problema(
                        titulo = "${r.litros} L · ${r.productorNombre}",
                        motivo = r.motivo ?: "Sin motivo",
                    )
                }
            }
        }

        BtnSecundario(texto = "Volver", onClick = onVolver)

        Text(
            TextosSync.lineaVersion(BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE, BuildConfig.GIT_COMMIT),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
        )
    }
}

@Composable
private fun Estado(pendientes: Int, ultimoSync: String) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                if (pendientes == 0) "Todo enviado" else "$pendientes sin enviar",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                color = if (pendientes == 0) MaterialTheme.colorScheme.primary
                else MaterialTheme.colorScheme.error,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    "Última sincronización:",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(ultimoSync, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun Seccion(titulo: String, contenido: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
        Text(titulo, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        contenido()
    }
}

/** Una fila con su motivo tal como lo dio el servidor: es lo que el acopiador tiene que poder dictar. */
@Composable
private fun Problema(titulo: String, motivo: String) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                titulo,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onErrorContainer,
            )
            Text(
                motivo,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onErrorContainer,
            )
        }
    }
}
