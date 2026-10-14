package pe.queseria.campo.ui.pin

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import pe.queseria.campo.datos.remoto.ErrorApp
import pe.queseria.campo.seguridad.Autenticador
import pe.queseria.campo.ui.componentes.MensajeError

// ─── ViewModel ───────────────────────────────────────────────────────────────

sealed class EstadoPin {
    data class Ingresando(val error: String? = null) : EstadoPin()
    data object Cargando : EstadoPin()
    data class Bloqueado(val hastaMs: Long) : EstadoPin()
}

sealed class EtapaCambio {
    data class PinActual(val error: String? = null) : EtapaCambio()
    data object PinNuevo : EtapaCambio()
    data class PinConfirmar(val error: String? = null) : EtapaCambio()
    data object Cargando : EtapaCambio()
}

class PinViewModel(private val autenticador: Autenticador) : ViewModel() {

    private val _estado = MutableStateFlow<EstadoPin>(EstadoPin.Ingresando())
    val estado: StateFlow<EstadoPin> = _estado.asStateFlow()

    private val _etapaCambio = MutableStateFlow<EtapaCambio>(EtapaCambio.PinActual())
    val etapaCambio: StateFlow<EtapaCambio> = _etapaCambio.asStateFlow()

    /** Dígitos 0-9 mezclados para el teclado de ingreso (no cambian mientras dure la sesión). */
    val digitosMezclados: List<Int> = (0..9).shuffled()

    fun ingresar(pin: String) {
        viewModelScope.launch {
            _estado.value = EstadoPin.Cargando
            try {
                autenticador.ingresar(pin)
                // Autenticador emite EstadoSesion.Abierta; MainActivity detecta el cambio
            } catch (e: ErrorApp.PinBloqueado) {
                // Sin bloqueo local no se inventa una cuenta atrás: se muestra lo que dijo el servidor
                _estado.value = autenticador.bloqueadoHasta()?.let { EstadoPin.Bloqueado(it) }
                    ?: EstadoPin.Ingresando(error = e.message)
            } catch (e: ErrorApp.DispositivoNoVinculado) {
                _estado.value = EstadoPin.Ingresando(error = e.message)
            } catch (e: ErrorApp.NoAutorizado) {
                _estado.value = EstadoPin.Ingresando(error = e.message)
            } catch (e: ErrorApp) {
                _estado.value = EstadoPin.Ingresando(error = e.message)
            }
        }
    }

    // PIN actual (en memoria solo durante el flujo de cambio, se borra al terminar)
    private var pinActualTemp = ""
    private var pinNuevoTemp = ""

    fun reiniciarCambio() {
        pinActualTemp = ""; pinNuevoTemp = ""
        _etapaCambio.value = EtapaCambio.PinActual()
    }

    fun avanzarCambio(pin: String) {
        when (val etapa = _etapaCambio.value) {
            is EtapaCambio.PinActual -> { pinActualTemp = pin; _etapaCambio.value = EtapaCambio.PinNuevo }
            is EtapaCambio.PinNuevo -> { pinNuevoTemp = pin; _etapaCambio.value = EtapaCambio.PinConfirmar() }
            is EtapaCambio.PinConfirmar -> {
                if (pin != pinNuevoTemp) {
                    _etapaCambio.value = EtapaCambio.PinConfirmar(
                        error = "Los PINs no coinciden. Vuelva a intentarlo")
                    return
                }
                viewModelScope.launch {
                    _etapaCambio.value = EtapaCambio.Cargando
                    try {
                        autenticador.cambiarPin(pinActualTemp, pinNuevoTemp)
                        pinActualTemp = ""; pinNuevoTemp = ""
                        // Autenticador emite Abierta(debeCambiarPin=false); MainActivity detecta el cambio
                    } catch (e: ErrorApp.PinBloqueado) {
                        pinActualTemp = ""; pinNuevoTemp = ""
                        autenticador.bloqueadoHasta()
                            ?.let { _estado.value = EstadoPin.Bloqueado(it) }
                            ?: run { _etapaCambio.value = EtapaCambio.PinActual(error = e.message) }
                    } catch (e: ErrorApp.NoAutorizado) {
                        pinActualTemp = ""; pinNuevoTemp = ""
                        _etapaCambio.value = EtapaCambio.PinActual(
                            error = "PIN actual incorrecto: ${e.message}")
                    } catch (e: ErrorApp) {
                        pinActualTemp = ""; pinNuevoTemp = ""
                        _etapaCambio.value = EtapaCambio.PinActual(error = e.message)
                    }
                }
            }
            EtapaCambio.Cargando -> { /* ignorar */ }
        }
    }

    companion object {
        fun factory(autenticador: Autenticador) = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>) =
                PinViewModel(autenticador) as T
        }
    }
}

// ─── Pantalla principal ───────────────────────────────────────────────────────

@Composable
fun PinPantalla(autenticador: Autenticador, debeCambiarPin: Boolean) {
    val vm: PinViewModel = viewModel(factory = PinViewModel.factory(autenticador))
    if (debeCambiarPin) CambiarPinPantalla(vm) else IngresoPin(vm)
}

// ─── B2: ingreso con PIN ──────────────────────────────────────────────────────

@Composable
private fun IngresoPin(vm: PinViewModel) {
    val estado by vm.estado.collectAsStateWithLifecycle()
    var pin by rememberSaveable { mutableStateOf("") }

    LaunchedEffect(estado) {
        if (estado is EstadoPin.Ingresando) pin = ""
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Quesería Campo", style = MaterialTheme.typography.titleSmall,
             color = MaterialTheme.colorScheme.primary)
        Text("Ingrese su PIN", style = MaterialTheme.typography.headlineMedium)

        Spacer(Modifier.height(8.dp))

        when (val e = estado) {
            is EstadoPin.Bloqueado -> BloqueoContador(e.hastaMs)
            is EstadoPin.Ingresando -> {
                DotPin(pin.length)
                e.error?.let { MensajeError(it) }
            }
            EstadoPin.Cargando -> DotPin(pin.length)
        }

        Spacer(Modifier.weight(1f))

        TecladoPin(
            digitos = vm.digitosMezclados,
            habilitado = estado is EstadoPin.Ingresando,
            onDigito = { if (pin.length < 6) pin += it.toString() },
            onBorrar = { if (pin.isNotEmpty()) pin = pin.dropLast(1) },
            onOk = { if (pin.length >= 4) vm.ingresar(pin) },
        )
    }
}

// ─── B2b: cambio de PIN obligatorio ──────────────────────────────────────────

@Composable
private fun CambiarPinPantalla(vm: PinViewModel) {
    val etapa by vm.etapaCambio.collectAsStateWithLifecycle()
    val estadoPin by vm.estado.collectAsStateWithLifecycle()

    // Si el ViewModel detecta bloqueo durante el cambio, redirige al estado de bloqueo del IngresoPin
    if (estadoPin is EstadoPin.Bloqueado) {
        IngresoPin(vm)
        return
    }

    // Generar dígitos mezclados para cada etapa (se vuelven a mezclar al cambiar de etapa)
    val digitosActual = remember(etapa) { (0..9).shuffled() }

    var pin by rememberSaveable(etapa) { mutableStateOf("") }

    val (titulo, subtitulo, error) = when (val e = etapa) {
        is EtapaCambio.PinActual ->
            Triple("Cambiar PIN", "Ingrese su PIN actual", e.error)
        EtapaCambio.PinNuevo ->
            Triple("Nuevo PIN", "Elija un nuevo PIN (4–6 dígitos)", null)
        is EtapaCambio.PinConfirmar ->
            Triple("Confirmar PIN", "Repita el nuevo PIN", e.error)
        EtapaCambio.Cargando ->
            Triple("Cambiando PIN…", "Por favor espere", null)
    }

    val cargando = etapa is EtapaCambio.Cargando
    val habilitado = !cargando

    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Quesería Campo", style = MaterialTheme.typography.titleSmall,
             color = MaterialTheme.colorScheme.primary)
        Text(titulo, style = MaterialTheme.typography.headlineMedium)
        Text(subtitulo, style = MaterialTheme.typography.bodyLarge)

        Spacer(Modifier.height(8.dp))

        DotPin(pin.length)
        error?.let { MensajeError(it) }

        Spacer(Modifier.weight(1f))

        TecladoPin(
            digitos = digitosActual,
            habilitado = habilitado,
            onDigito = { if (pin.length < 6) pin += it.toString() },
            onBorrar = { if (pin.isNotEmpty()) pin = pin.dropLast(1) },
            onOk = {
                if (pin.length >= 4) {
                    vm.avanzarCambio(pin)
                    pin = ""
                }
            },
        )

        if (etapa is EtapaCambio.PinNuevo || etapa is EtapaCambio.PinConfirmar) {
            OutlinedButton(
                onClick = { vm.reiniciarCambio(); pin = "" },
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) {
                Text("Volver al inicio")
            }
        }
    }
}

// ─── Componentes del teclado ─────────────────────────────────────────────────

@Composable
fun DotPin(cantidad: Int, maximo: Int = 6, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        repeat(maximo) { i ->
            Box(
                Modifier
                    .size(18.dp)
                    .clip(CircleShape)
                    .background(
                        if (i < cantidad) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.outlineVariant,
                    ),
            )
        }
    }
}

@Composable
fun TecladoPin(
    digitos: List<Int>,
    onDigito: (Int) -> Unit,
    onBorrar: () -> Unit,
    onOk: () -> Unit,
    habilitado: Boolean = true,
) {
    val filas = listOf(0 until 3, 3 until 6, 6 until 9)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
        filas.forEach { rango ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                rango.forEach { i ->
                    val d = digitos[i]
                    FilledTonalButton(
                        onClick = { onDigito(d) },
                        enabled = habilitado,
                        modifier = Modifier.weight(1f).height(60.dp),
                    ) {
                        Text(d.toString(), style = MaterialTheme.typography.headlineSmall)
                    }
                }
            }
        }
        // Última fila: Borrar | dígito[9] | OK
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedButton(
                onClick = onBorrar,
                enabled = habilitado,
                modifier = Modifier.weight(1f).height(60.dp),
            ) {
                Text("⌫", style = MaterialTheme.typography.headlineSmall)
            }
            FilledTonalButton(
                onClick = { onDigito(digitos[9]) },
                enabled = habilitado,
                modifier = Modifier.weight(1f).height(60.dp),
            ) {
                Text(digitos[9].toString(), style = MaterialTheme.typography.headlineSmall)
            }
            Button(
                onClick = onOk,
                enabled = habilitado,
                modifier = Modifier.weight(1f).height(60.dp),
            ) {
                Text("OK", style = MaterialTheme.typography.titleLarge)
            }
        }
    }
}

@Composable
private fun BloqueoContador(hastaMs: Long) {
    var restanMs by remember(hastaMs) {
        mutableStateOf((hastaMs - System.currentTimeMillis()).coerceAtLeast(0))
    }
    LaunchedEffect(hastaMs) {
        while (restanMs > 0) {
            delay(500)
            restanMs = (hastaMs - System.currentTimeMillis()).coerceAtLeast(0)
        }
    }
    val minutos = restanMs / 60_000
    val segundos = (restanMs % 60_000) / 1000
    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        MensajeError("PIN bloqueado por intentos fallidos")
        Text(
            "Puede intentar en %d:%02d".format(minutos, segundos),
            style = MaterialTheme.typography.titleLarge,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.error,
        )
    }
}
