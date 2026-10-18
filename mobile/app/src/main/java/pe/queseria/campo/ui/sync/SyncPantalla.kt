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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
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
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import pe.queseria.campo.BuildConfig
import pe.queseria.campo.datos.local.Meta
import pe.queseria.campo.datos.local.MetaEntidad
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
import pe.queseria.campo.ui.tema.ColorAdvertencia

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

    val productoresPendientes: StateFlow<Int> = dao.observarProductoresPendientes()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 0)

    val ultimoSyncMs: StateFlow<Long?> = dao.observarMeta(Meta.ULTIMO_SYNC_MS)
        .map { it?.toLongOrNull() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val ultimoError: StateFlow<String?> = dao.observarMeta(Meta.ULTIMO_ERROR_SYNC)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** Rechazos agrupados: por avisar al administrador y ya avisados. */
    val rechazos: StateFlow<TextosSync.PanoramaRechazos> = combine(
        dao.observarProductoresRechazados(),
        dao.observarRechazadas(),
        dao.observarEntregasRetenidas(),
        dao.observarMeta(Meta.AVISOS_VISTOS),
    ) { productores, rechazadas, retenidas, avisados ->
        TextosSync.panorama(productores, rechazadas, retenidas, TextosSync.leerAvisados(avisados))
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SIN_RECHAZOS)

    /**
     * "Ya avisé": solo guarda la marca en Meta. El productor y su leche siguen en Room como RECHAZADO
     * (la purga solo borra lo SINCRONIZADO), así que la entrega se puede seguir consultando.
     */
    fun marcarAvisado(clave: String) {
        viewModelScope.launch {
            val actual = dao.meta(Meta.AVISOS_VISTOS)
            dao.guardarMeta(MetaEntidad(Meta.AVISOS_VISTOS, TextosSync.agregarAvisado(actual, clave)))
        }
    }

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
        val SIN_RECHAZOS = TextosSync.PanoramaRechazos(
            porAvisar = TextosSync.Rechazos(emptyList(), emptyList()),
            avisados = TextosSync.Rechazos(emptyList(), emptyList()),
        )

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
    val productoresPendientes by vm.productoresPendientes.collectAsStateWithLifecycle()
    val ultimoSyncMs by vm.ultimoSyncMs.collectAsStateWithLifecycle()
    val ultimoError by vm.ultimoError.collectAsStateWithLifecycle()
    val rechazos by vm.rechazos.collectAsStateWithLifecycle()
    var verAvisados by rememberSaveable { mutableStateOf(false) }
    val context = LocalContext.current

    val porAvisar = rechazos.porAvisar
    val avisados = rechazos.avisados

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Sincronización", style = MaterialTheme.typography.headlineSmall)

        Estado(
            titular = TextosSync.titular(pendientes, productoresPendientes, porAvisar.total),
            ultimoSync = TextosSync.textoUltimoSync(ultimoSyncMs, System.currentTimeMillis()),
        )

        when (val e = estado) {
            // Sin resumen propio todavía, se muestra lo último que dejó el worker en segundo plano
            is EstadoSincronizacion.Listo ->
                if (e.resumen == null) {
                    ultimoError?.let { MensajeAviso("Último intento: $it") }
                } else if (e.resumen.rechazados > 0) {
                    // Con rechazos no va el "✓": hay algo que el acopiador tiene que avisar
                    MensajeError(TextosSync.textoResumen(e.resumen))
                } else {
                    MensajeAviso("✓ ${TextosSync.textoResumen(e.resumen)}")
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

        if (porAvisar.altas.isNotEmpty()) {
            Seccion("Altas de productor rechazadas") {
                porAvisar.altas.forEach { a ->
                    TarjetaAlta(a, onAvisado = { vm.marcarAvisado(TextosSync.avisoDeAlta(a.productor.clave)) })
                }
            }
        }

        if (porAvisar.sueltas.isNotEmpty()) {
            Seccion("Entregas rechazadas") {
                porAvisar.sueltas.forEach { r ->
                    TarjetaEntrega(r, onAvisado = { vm.marcarAvisado(TextosSync.avisoDeEntrega(r.id)) })
                }
            }
        }

        if (avisados.total > 0) {
            BtnSecundario(
                texto = if (verAvisados) "Ocultar las ya avisadas" else "Ver las ya avisadas (${avisados.total})",
                onClick = { verAvisados = !verAvisados },
            )
            if (verAvisados) {
                Text(
                    "Ya avisó al administrador. Se siguen guardando en este celular; no se borra nada.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                avisados.altas.forEach { TarjetaAlta(it, onAvisado = null) }
                avisados.sueltas.forEach { TarjetaEntrega(it, onAvisado = null) }
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
private fun Estado(titular: TextosSync.Titular, ultimoSync: String) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                titular.texto,
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                color = when (titular.tono) {
                    TextosSync.Tono.BIEN -> MaterialTheme.colorScheme.primary
                    TextosSync.Tono.ADVERTENCIA -> ColorAdvertencia
                    TextosSync.Tono.ERROR -> MaterialTheme.colorScheme.error
                },
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

/**
 * Alta rechazada con la leche que se le registró. Esa leche ya se recibió y no se puede reapuntar a otro
 * productor sin romper la firma (pendiente (H)): lo único que el acopiador puede hacer es avisar.
 * [onAvisado] null = ya avisada (se muestra sin botón).
 */
@Composable
private fun TarjetaAlta(alta: TextosSync.AltaRechazada, onAvisado: (() -> Unit)?) {
    Problema(
        titulo = alta.productor.nombre,
        motivo = alta.productor.motivo ?: "El servidor rechazó el alta del productor",
        onAvisado = onAvisado,
    ) {
        if (alta.entregas.isNotEmpty()) {
            Text(
                "Su leche ya se recibió y no se puede pasar a otro productor desde el celular:",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onErrorContainer,
            )
            alta.entregas.forEach {
                Text(
                    TextosSync.textoRetenida(it),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                )
            }
        }
    }
}

@Composable
private fun TarjetaEntrega(r: RecoleccionEntidad, onAvisado: (() -> Unit)?) {
    Problema(
        titulo = "${r.litros} L · ${r.productorNombre}",
        motivo = r.motivo ?: "Sin motivo",
        onAvisado = onAvisado,
    )
}

/** Una fila con su motivo tal como lo dio el servidor: es lo que el acopiador tiene que poder dictar. */
@Composable
private fun Problema(
    titulo: String,
    motivo: String,
    onAvisado: (() -> Unit)?,
    detalle: @Composable () -> Unit = {},
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
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
            detalle()
            if (onAvisado != null) {
                Text(
                    "Avise al administrador: dígale el nombre y este motivo.",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                    modifier = Modifier.padding(top = 4.dp),
                )
                BtnSecundario(texto = "Ya avisé", onClick = onAvisado)
            }
        }
    }
}
