package pe.queseria.campo.ui.inicio

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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import pe.queseria.campo.datos.local.Meta
import pe.queseria.campo.datos.local.ProductorFila
import pe.queseria.campo.datos.local.SyncDao
import pe.queseria.campo.sync.SyncWorker
import pe.queseria.campo.ui.componentes.MensajeAviso
import java.time.LocalDate
import java.time.ZoneId

// ─── ViewModel ───────────────────────────────────────────────────────────────

class InicioViewModel(private val dao: SyncDao) : ViewModel() {

    /** El día de trabajo en hora de Lima; se revisa al volver a la pantalla (una ruta puede cruzar medianoche). */
    private val dia = MutableStateFlow(LocalDate.now(LIMA))

    private val _busqueda = MutableStateFlow("")
    val busqueda: StateFlow<String> = _busqueda.asStateFlow()

    @OptIn(ExperimentalCoroutinesApi::class)
    private val filas: Flow<List<ProductorFila>> = dia.flatMapLatest { d ->
        dao.observarProductores(
            desdeMs = d.atStartOfDay(LIMA).toInstant().toEpochMilli(),
            hastaMs = d.plusDays(1).atStartOfDay(LIMA).toInstant().toEpochMilli(),
        )
    }

    val productores: StateFlow<List<ProductorFila>> =
        combine(filas, _busqueda) { fs, b -> fs.filter { ResumenProductor.coincide(it, b) } }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val pendientes: StateFlow<Int> =
        dao.observarPendientes().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 0)

    /** Sin un pull previo la lista está vacía porque nunca se bajó la ruta, no porque no haya productores. */
    val yaSincronizo: StateFlow<Boolean> =
        dao.observarMeta(Meta.CURSOR_PULL).map { it != null }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), true)

    fun buscar(texto: String) { _busqueda.value = texto }

    fun revisarDia() {
        val hoy = LocalDate.now(LIMA)
        if (hoy != dia.value) dia.value = hoy
    }

    companion object {
        private val LIMA: ZoneId = ZoneId.of("America/Lima")

        fun factory(dao: SyncDao) = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>) = InicioViewModel(dao) as T
        }
    }
}

// ─── B3: mis productores ─────────────────────────────────────────────────────

@Composable
fun InicioPantalla(
    dao: SyncDao,
    nombreAcopiador: String,
    conServidor: Boolean,
    aviso: String?,
    onRegistrar: (ProductorFila) -> Unit,
) {
    val vm: InicioViewModel = viewModel(factory = InicioViewModel.factory(dao))
    val productores by vm.productores.collectAsStateWithLifecycle()
    val pendientes by vm.pendientes.collectAsStateWithLifecycle()
    val yaSincronizo by vm.yaSincronizo.collectAsStateWithLifecycle()
    val busqueda by vm.busqueda.collectAsStateWithLifecycle()
    val context = LocalContext.current

    // Productor que ya entregó hoy y espera confirmación de otra entrega. Al rotar solo se cierra
    // el aviso (nada que perder): la fila se vuelve a tocar.
    var confirmarOtra by remember { mutableStateOf<ProductorFila?>(null) }

    LaunchedEffect(Unit) { vm.revisarDia() }

    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Barra(
            nombreAcopiador = nombreAcopiador,
            pendientes = pendientes,
            onSincronizar = { SyncWorker.sincronizarAhora(context) },
        )

        if (!conServidor) {
            MensajeAviso("⚠ Sin señal — ingresaste sin conexión. Lo que registres se enviará solo.")
        }
        aviso?.let { MensajeAviso(it) }

        OutlinedTextField(
            value = busqueda,
            onValueChange = vm::buscar,
            label = { Text("Buscar por nombre o código") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )

        if (productores.isEmpty()) {
            Text(
                if (!yaSincronizo) "Todavía no se bajó su ruta. Conéctese y toque Sincronizar."
                else if (busqueda.isBlank()) "No hay productores en sus rutas."
                else "Ningún productor coincide con la búsqueda.",
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.padding(top = 16.dp),
            )
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(productores, key = { it.clave }) { fila ->
                    FilaProductor(fila) {
                        if (ResumenProductor.pideConfirmarOtraEntrega(fila)) confirmarOtra = fila
                        else onRegistrar(fila)
                    }
                }
            }
        }
    }

    confirmarOtra?.let { fila ->
        AlertDialog(
            onDismissRequest = { confirmarOtra = null },
            title = { Text("¿Otra entrega?") },
            text = { Text(ResumenProductor.textoOtraEntrega(fila)) },
            confirmButton = {
                TextButton(onClick = {
                    confirmarOtra = null
                    onRegistrar(fila)
                }) { Text("Sí, otra entrega") }
            },
            dismissButton = {
                TextButton(onClick = { confirmarOtra = null }) { Text("Cancelar") }
            },
        )
    }
}

@Composable
private fun Barra(nombreAcopiador: String, pendientes: Int, onSincronizar: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text("Mis productores", style = MaterialTheme.typography.headlineSmall)
            Text(
                if (pendientes == 0) nombreAcopiador else "$nombreAcopiador · $pendientes sin enviar",
                style = MaterialTheme.typography.bodyMedium,
                color = if (pendientes == 0) MaterialTheme.colorScheme.onSurfaceVariant
                else MaterialTheme.colorScheme.primary,
            )
        }
        OutlinedButton(onClick = onSincronizar, modifier = Modifier.heightIn(min = 48.dp)) {
            Text("Sincronizar")
        }
    }
}

@Composable
private fun FilaProductor(fila: ProductorFila, onClick: () -> Unit) {
    val rojo = ResumenProductor.enRojo(fila)
    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (rojo) MaterialTheme.colorScheme.errorContainer
            else MaterialTheme.colorScheme.surfaceVariant,
        ),
        modifier = Modifier.fillMaxWidth().heightIn(min = 72.dp).clickable(onClick = onClick),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    fila.nombre,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = if (rojo) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    listOfNotNull(fila.codigo, fila.rutaNombre).joinToString(" · ").ifEmpty { "Alta de campo" },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                ResumenProductor.aviso(fila)?.let {
                    Text(it, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.error)
                }
                if (ResumenProductor.noAprobado(fila)) {
                    Text(
                        if (ResumenProductor.sinEnviar(fila)) "No aprobado · sin enviar" else "No aprobado",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Text(
                ResumenProductor.estadoDelDia(fila),
                style = MaterialTheme.typography.titleMedium,
                color = if (fila.nHoy == 0) MaterialTheme.colorScheme.onSurfaceVariant
                else MaterialTheme.colorScheme.primary,
            )
        }
    }
}
