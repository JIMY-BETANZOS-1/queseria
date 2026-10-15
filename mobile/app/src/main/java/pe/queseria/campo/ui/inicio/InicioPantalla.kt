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
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import pe.queseria.campo.datos.local.Meta
import pe.queseria.campo.datos.local.ProductorFila
import pe.queseria.campo.datos.local.SyncDao
import pe.queseria.campo.sync.MiDia
import pe.queseria.campo.ui.componentes.MensajeAviso
import java.time.LocalDate
import java.time.ZoneId

// ─── ViewModel ───────────────────────────────────────────────────────────────

class InicioViewModel(private val dao: SyncDao, private val miDia: MiDia) : ViewModel() {

    /** Lo que el servidor dice que se registró hoy; `null` mientras no se haya podido consultar. */
    private sealed interface DelServidor {
        data object NoConsultado : DelServidor
        data object Fallo : DelServidor
        data class Ok(val entregas: List<EntregaServidor>) : DelServidor
    }

    /** El día de trabajo en hora de Lima; se revisa al volver a la pantalla (una ruta puede cruzar medianoche). */
    private val dia = MutableStateFlow(LocalDate.now(LIMA))

    private val _busqueda = MutableStateFlow("")
    val busqueda: StateFlow<String> = _busqueda.asStateFlow()

    private val _delServidor = MutableStateFlow<DelServidor>(DelServidor.NoConsultado)
    private var consultando = false

    @OptIn(ExperimentalCoroutinesApi::class)
    private val filas: Flow<List<ProductorFila>> = dia.flatMapLatest { d ->
        dao.observarProductores(desdeMs = d.inicioMs(), hastaMs = d.finMs())
    }

    /** Ids de hoy que ya están en este celular: lo que el servidor repita no se cuenta dos veces. */
    @OptIn(ExperimentalCoroutinesApi::class)
    private val idsLocales: Flow<List<String>> = dia.flatMapLatest { d ->
        dao.observarIdsRecolecciones(desdeMs = d.inicioMs(), hastaMs = d.finMs())
    }

    /** Todos los productores de sus rutas, ya con lo del servidor fusionado (sin filtrar por búsqueda). */
    val todas: StateFlow<List<ProductorFila>> =
        combine(filas, idsLocales, _delServidor) { fs, ids, serv ->
            val entregas = (serv as? DelServidor.Ok)?.entregas ?: emptyList()
            RehidratarDia.fusionar(fs, entregas, ids.toSet())
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val productores: StateFlow<List<ProductorFila>> =
        combine(todas, _busqueda) { ts, b -> ts.filter { ResumenProductor.coincide(it, b) } }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val pendientes: StateFlow<Int> =
        dao.observarPendientes().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 0)

    /** Sin un pull previo la lista está vacía porque nunca se bajó la ruta, no porque no haya productores. */
    val yaSincronizo: StateFlow<Boolean> =
        dao.observarMeta(Meta.CURSOR_PULL).map { it != null }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), true)

    /**
     * No se pudo preguntar al servidor y este celular no tiene nada de hoy: "Pendiente" en todas las
     * filas puede estar mintiendo (celular reinstalado). Con algo registrado hoy no se avisa nada,
     * para no repetir el aviso toda una jornada sin señal.
     */
    val puedeFaltarLoDeHoy: StateFlow<Boolean> =
        combine(_delServidor, idsLocales) { serv, ids -> serv is DelServidor.Fallo && ids.isEmpty() }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    init {
        // Al abrir y después de cada sincronización (el botón y el worker mueven ULTIMO_SYNC_MS)
        viewModelScope.launch {
            dao.observarMeta(Meta.ULTIMO_SYNC_MS).distinctUntilChanged().collect { rehidratar() }
        }
    }

    /** Pregunta al servidor qué se registró hoy. Sin red no pasa nada: se sigue con lo local. */
    fun rehidratar() {
        if (consultando) return
        consultando = true
        viewModelScope.launch {
            _delServidor.value = try {
                miDia.obtener().servidor
                    ?.let { d -> DelServidor.Ok(d.recolecciones.map(EntregaServidor::de)) }
                    ?: DelServidor.Fallo
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                DelServidor.Fallo
            } finally {
                consultando = false
            }
        }
    }

    fun buscar(texto: String) { _busqueda.value = texto }

    fun revisarDia() {
        val hoy = LocalDate.now(LIMA)
        if (hoy != dia.value) dia.value = hoy
    }

    companion object {
        private val LIMA: ZoneId = ZoneId.of("America/Lima")

        private fun LocalDate.inicioMs() = atStartOfDay(LIMA).toInstant().toEpochMilli()
        private fun LocalDate.finMs() = plusDays(1).atStartOfDay(LIMA).toInstant().toEpochMilli()

        fun factory(dao: SyncDao, miDia: MiDia) = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>) = InicioViewModel(dao, miDia) as T
        }
    }
}

// ─── B3: mis productores ─────────────────────────────────────────────────────

@Composable
fun InicioPantalla(
    dao: SyncDao,
    miDia: MiDia,
    nombreAcopiador: String,
    conServidor: Boolean,
    /** Aviso fijo del cambio de PIN que espera señal: no se cierra ni se consume. */
    avisoPinPendiente: String?,
    aviso: String?,
    /** Clave del productor que ya entregó hoy y espera el "¿Otra entrega?" (la trae el destino). */
    confirmar: String?,
    onTocarProductor: (ProductorFila) -> Unit,
    onConfirmarOtraEntrega: () -> Unit,
    onCancelarConfirmacion: () -> Unit,
    onNuevoProductor: () -> Unit,
    onMiDia: () -> Unit,
    onSincronizar: () -> Unit,
) {
    val vm: InicioViewModel = viewModel(factory = InicioViewModel.factory(dao, miDia))
    val todas by vm.todas.collectAsStateWithLifecycle()
    val productores by vm.productores.collectAsStateWithLifecycle()
    val pendientes by vm.pendientes.collectAsStateWithLifecycle()
    val yaSincronizo by vm.yaSincronizo.collectAsStateWithLifecycle()
    val puedeFaltarLoDeHoy by vm.puedeFaltarLoDeHoy.collectAsStateWithLifecycle()
    val busqueda by vm.busqueda.collectAsStateWithLifecycle()

    // Se busca en la lista completa: el aviso no debe desaparecer si se escribe en el buscador
    val porConfirmar = confirmar?.let { c -> todas.firstOrNull { it.clave == c } }

    LaunchedEffect(Unit) {
        vm.revisarDia()
        vm.rehidratar()   // por si la pantalla se reabre sin que haya habido una sincronización
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Barra(nombreAcopiador = nombreAcopiador, pendientes = pendientes)

        Acciones(
            onNuevoProductor = onNuevoProductor,
            onMiDia = onMiDia,
            onSincronizar = onSincronizar,
        )

        // Primero el del PIN: es lo único que el acopiador tiene que recordar hacer al recuperar señal
        avisoPinPendiente?.let { MensajeAviso(it) }

        if (!conServidor) {
            MensajeAviso("⚠ Sin señal — ingresaste sin conexión. Lo que registres se enviará solo.")
        }
        if (puedeFaltarLoDeHoy) {
            MensajeAviso(
                "Sin conexión con el servidor: si hoy ya se registró leche en otro celular, " +
                    "todavía no se ve acá. Sincronice cuando tenga señal.",
            )
        }
        aviso?.let { MensajeAviso(it) }

        // Panel en la propia pantalla, no un AlertDialog: una ventana de diálogo le devolvía el
        // gesto atrás a la actividad al cerrarse y B4 se cancelaba al entrar (ver Rumbo).
        porConfirmar?.let { fila ->
            PanelOtraEntrega(
                texto = ResumenProductor.textoOtraEntrega(fila),
                onSi = onConfirmarOtraEntrega,
                onCancelar = onCancelarConfirmacion,
            )
        }

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
                    FilaProductor(fila) { onTocarProductor(fila) }
                }
            }
        }
    }
}

/** Aviso de B3 antes de la segunda entrega del día: botones grandes, en la propia pantalla. */
@Composable
private fun PanelOtraEntrega(texto: String, onSi: () -> Unit, onCancelar: () -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                "¿Otra entrega?",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSecondaryContainer,
            )
            Text(
                texto,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSecondaryContainer,
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedButton(
                    onClick = onCancelar,
                    modifier = Modifier.weight(1f).heightIn(min = 52.dp),
                ) { Text("Cancelar") }
                Button(
                    onClick = onSi,
                    modifier = Modifier.weight(1f).heightIn(min = 52.dp),
                ) { Text("Sí, otra entrega") }
            }
        }
    }
}

/**
 * Accesos a las pantallas que no son la lista. Botones anchos y altos: se usan de pie, en el campo,
 * a veces con guantes.
 *
 * "Sincronizar" abre B7 en lugar de disparar el worker desde aquí: así el acopiador ve qué se envió y
 * qué se rechazó, en vez de tocar un botón que no contesta nada.
 */
@Composable
private fun Acciones(onNuevoProductor: () -> Unit, onMiDia: () -> Unit, onSincronizar: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        OutlinedButton(
            onClick = onNuevoProductor,
            modifier = Modifier.weight(1f).heightIn(min = 56.dp),
        ) {
            Text("+ Productor", style = MaterialTheme.typography.titleMedium)
        }
        OutlinedButton(
            onClick = onMiDia,
            modifier = Modifier.weight(1f).heightIn(min = 56.dp),
        ) {
            Text("Mi día", style = MaterialTheme.typography.titleMedium)
        }
        OutlinedButton(
            onClick = onSincronizar,
            modifier = Modifier.weight(1f).heightIn(min = 56.dp),
        ) {
            Text("Sincronizar", style = MaterialTheme.typography.titleMedium)
        }
    }
}

@Composable
private fun Barra(nombreAcopiador: String, pendientes: Int) {
    Column(Modifier.fillMaxWidth()) {
        Text("Mis productores", style = MaterialTheme.typography.headlineSmall)
        Text(
            if (pendientes == 0) nombreAcopiador else "$nombreAcopiador · $pendientes sin enviar",
            style = MaterialTheme.typography.bodyMedium,
            color = if (pendientes == 0) MaterialTheme.colorScheme.onSurfaceVariant
            else MaterialTheme.colorScheme.primary,
        )
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
