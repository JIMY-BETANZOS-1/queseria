package pe.queseria.campo.ui.registro

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import pe.queseria.campo.datos.local.ProductorFila
import pe.queseria.campo.datos.local.SyncDao
import pe.queseria.campo.registro.EntradaLitros
import pe.queseria.campo.registro.LecturaUbicacion
import pe.queseria.campo.registro.NuevaRecoleccion
import pe.queseria.campo.registro.OrigenUbicacion
import pe.queseria.campo.registro.Registrador
import pe.queseria.campo.sync.SyncWorker
import pe.queseria.campo.ubicacion.Ubicador
import pe.queseria.campo.ui.componentes.BtnPrimario
import pe.queseria.campo.ui.componentes.MensajeAviso
import pe.queseria.campo.ui.componentes.MensajeError
import pe.queseria.campo.ui.componentes.TecladoNumerico
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

// ─── ViewModel ───────────────────────────────────────────────────────────────

sealed class EstadoRegistro {
    data class Editando(val error: String? = null) : EstadoRegistro()
    data object Guardando : EstadoRegistro()
    data class Guardado(val litros: String, val productor: String) : EstadoRegistro()
}

/**
 * Registro de una recolección (B4).
 *
 * Antidoble-toque: [registrar] descarta la llamada si el estado ya no es [EstadoRegistro.Editando].
 * Hace falta porque cada llamada a [Registrador.registrar] genera su propio UUID: dos toques
 * crearían dos recolecciones distintas y los litros se sumarían dos veces.
 */
class RegistrarViewModel(
    claveProductor: String,
    dao: SyncDao,
    private val registrador: Registrador,
    private val ubicador: Ubicador,
) : ViewModel() {

    private val hoy = LocalDate.now(LIMA)

    val productor: StateFlow<ProductorFila?> = dao.observarProductor(
        clave = claveProductor,
        desdeMs = hoy.atStartOfDay(LIMA).toInstant().toEpochMilli(),
        hastaMs = hoy.plusDays(1).atStartOfDay(LIMA).toInstant().toEpochMilli(),
    ).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    private val _estado = MutableStateFlow<EstadoRegistro>(EstadoRegistro.Editando())
    val estado: StateFlow<EstadoRegistro> = _estado.asStateFlow()

    private val _ubicacion = MutableStateFlow<LecturaUbicacion?>(null)
    val ubicacion: StateFlow<LecturaUbicacion?> = _ubicacion.asStateFlow()

    private val _conPermiso = MutableStateFlow(ubicador.conPermiso())
    val conPermiso: StateFlow<Boolean> = _conPermiso.asStateFlow()

    private var trabajoGps: Job? = null

    /** Enciende el GPS mientras la pantalla está abierta. Guardar no espera por él. */
    fun iniciarUbicacion() {
        _conPermiso.value = ubicador.conPermiso()
        if (!_conPermiso.value || trabajoGps?.isActive == true) return
        trabajoGps = viewModelScope.launch {
            // La última conocida da algo desde el primer segundo; el fix vivo la reemplaza
            launch {
                ubicador.ultimaConocida()?.let { u -> if (_ubicacion.value == null) _ubicacion.value = u }
            }
            ubicador.flujo().collect { _ubicacion.value = it }
        }
    }

    fun detenerUbicacion() {
        trabajoGps?.cancel()
        trabajoGps = null
    }

    fun registrar(litrosTexto: String, observacion: String, horaAutomatica: Boolean) {
        if (_estado.value !is EstadoRegistro.Editando) return      // antidoble-toque
        val fila = productor.value
        val litros = EntradaLitros.valor(litrosTexto)
        if (fila == null || litros == null) {
            _estado.value = EstadoRegistro.Editando("Ingrese los litros recibidos")
            return
        }
        _estado.value = EstadoRegistro.Guardando
        viewModelScope.launch {
            try {
                val r = registrador.registrar(
                    NuevaRecoleccion(
                        productorId = fila.servidorId,
                        productorUuidCliente = fila.uuidCliente,
                        productorNombre = fila.nombre,
                        litros = litros,
                        observacion = observacion.trim().ifEmpty { null },
                        ubicacion = _ubicacion.value,
                        horaAutomatica = horaAutomatica,
                    ),
                )
                _estado.value = EstadoRegistro.Guardado(r.litros, fila.nombre)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _estado.value = EstadoRegistro.Editando(e.message ?: "No se pudo guardar la recolección")
            }
        }
    }

    override fun onCleared() {
        detenerUbicacion()
    }

    companion object {
        private val LIMA: ZoneId = ZoneId.of("America/Lima")

        fun factory(clave: String, dao: SyncDao, registrador: Registrador, ubicador: Ubicador) =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>) =
                    RegistrarViewModel(clave, dao, registrador, ubicador) as T
            }
    }
}

// ─── B4: registrar recolección ───────────────────────────────────────────────

@Composable
fun RegistrarPantalla(
    claveProductor: String,
    dao: SyncDao,
    registrador: Registrador,
    ubicador: Ubicador,
    onGuardado: (litros: String, productor: String) -> Unit,
    onCancelar: () -> Unit,
) {
    val vm: RegistrarViewModel = viewModel(
        key = claveProductor,
        factory = RegistrarViewModel.factory(claveProductor, dao, registrador, ubicador),
    )
    val context = LocalContext.current
    val fila by vm.productor.collectAsStateWithLifecycle()
    val estado by vm.estado.collectAsStateWithLifecycle()
    val ubicacion by vm.ubicacion.collectAsStateWithLifecycle()
    val conPermiso by vm.conPermiso.collectAsStateWithLifecycle()

    val horaAutomatica = remember { Registrador.horaAutomatica(context) }
    var litros by rememberSaveable { mutableStateOf("") }
    var observacion by rememberSaveable { mutableStateOf("") }
    var mostrarObservacion by rememberSaveable { mutableStateOf(false) }
    var confirmarBloqueado by remember { mutableStateOf(false) }

    val permisos = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        vm.iniciarUbicacion()   // conceda o no: el registro sigue disponible
    }
    LaunchedEffect(Unit) {
        if (ubicador.conPermiso()) vm.iniciarUbicacion() else permisos.launch(Ubicador.PERMISOS)
    }
    DisposableEffect(Unit) { onDispose { vm.detenerUbicacion() } }

    // Guardado: se sincroniza y se vuelve a B3 una sola vez
    LaunchedEffect(estado) {
        (estado as? EstadoRegistro.Guardado)?.let {
            SyncWorker.sincronizarAhora(context)
            onGuardado(it.litros, it.productor)
        }
    }

    val editando = estado is EstadoRegistro.Editando
    val puedeGuardar = editando && EntradaLitros.valor(litros) != null && fila != null

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    fila?.nombre ?: "Productor",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    listOfNotNull(fila?.codigo, fila?.rutaNombre).joinToString(" · ")
                        .ifEmpty { "Alta de campo (no aprobado)" },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            TextButton(onClick = onCancelar, enabled = editando) { Text("Cancelar") }
        }

        if (fila?.bloqueado == true) {
            MensajeError("Productor bloqueado, no debe entregar leche")
        } else if (fila?.sancionado == true) {
            MensajeAviso("Productor sancionado: su leche se paga a precio de sanción.")
        }
        if (fila?.aprobado == false) {
            MensajeAviso("Productor no aprobado: el pago queda retenido hasta que el administrador lo apruebe.")
        }

        VisorLitros(litros)

        TecladoNumerico(
            onDigito = { litros = EntradaLitros.agregarDigito(litros, it) },
            onPunto = { litros = EntradaLitros.agregarPunto(litros) },
            onBorrar = { litros = EntradaLitros.borrar(litros) },
            habilitado = editando,
        )

        if (mostrarObservacion) {
            OutlinedTextField(
                value = observacion,
                onValueChange = { observacion = it.take(200) },
                label = { Text("Observación (opcional)") },
                singleLine = true,
                enabled = editando,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                modifier = Modifier.fillMaxWidth(),
            )
        } else {
            TextButton(onClick = { mostrarObservacion = true }, enabled = editando) {
                Text("Agregar observación")
            }
        }

        LineaUbicacion(ubicacion, conPermiso)
        if (!horaAutomatica) {
            Text(
                "La hora automática del celular está desactivada",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }
        (estado as? EstadoRegistro.Editando)?.error?.let { MensajeError(it) }

        BtnPrimario(
            texto = "GUARDAR RECOLECCIÓN",
            onClick = {
                if (fila?.bloqueado == true) confirmarBloqueado = true
                else vm.registrar(litros, observacion, horaAutomatica)
            },
            habilitado = puedeGuardar,
            cargando = estado is EstadoRegistro.Guardando,
        )
    }

    if (confirmarBloqueado) {
        AlertDialog(
            onDismissRequest = { confirmarBloqueado = false },
            title = { Text("Productor bloqueado") },
            text = {
                Text(
                    "Este productor no debe entregar leche. ¿Confirma que la recibió? " +
                        "Se registrará igual y el pago quedará retenido hasta que el administrador lo revise.",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmarBloqueado = false
                    vm.registrar(litros, observacion, horaAutomatica)
                }) { Text("Sí, recibí la leche") }
            },
            dismissButton = {
                TextButton(onClick = { confirmarBloqueado = false }) { Text("Cancelar") }
            },
        )
    }
}

@Composable
private fun VisorLitros(litros: String) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
            Text(
                "LITROS",
                style = MaterialTheme.typography.labelLarge,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
            Text(
                EntradaLitros.paraMostrar(litros),
                style = MaterialTheme.typography.displaySmall,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun LineaUbicacion(lectura: LecturaUbicacion?, conPermiso: Boolean) {
    val texto = textoUbicacion(lectura, conPermiso)
    Text(
        texto,
        style = MaterialTheme.typography.bodyMedium,
        color = if (lectura?.origen == OrigenUbicacion.GPS) MaterialTheme.colorScheme.primary
        else MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

private val HORA_LOCAL = DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.of("America/Lima"))

/** Estado del GPS. Nunca dice que falte algo para guardar: la ubicación no bloquea el registro. */
internal fun textoUbicacion(lectura: LecturaUbicacion?, conPermiso: Boolean): String = when {
    !conPermiso -> "Sin permiso de ubicación — se guardará sin GPS"
    lectura == null -> "Buscando GPS… — se guardará igual"
    else -> {
        val precision = lectura.precisionM?.let { " ±${it.toInt()} m" } ?: ""
        val hora = lectura.horaGps?.let { " · ${HORA_LOCAL.format(it)}" } ?: ""
        val simulada = if (lectura.simulada) " · ubicación simulada" else ""
        when (lectura.origen) {
            OrigenUbicacion.GPS -> "GPS$precision$hora$simulada"
            else -> "Última ubicación conocida$precision$simulada"
        }
    }
}
