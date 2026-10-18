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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
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
import pe.queseria.campo.datos.remoto.ErrorApp
import pe.queseria.campo.seguridad.Autenticador
import pe.queseria.campo.seguridad.ReglasPin
import pe.queseria.campo.sync.SyncWorker
import pe.queseria.campo.ui.componentes.BtnPrimario
import pe.queseria.campo.ui.componentes.BtnSecundario
import pe.queseria.campo.ui.componentes.MensajeAviso
import pe.queseria.campo.ui.componentes.MensajeError
import pe.queseria.campo.ui.componentes.TecladoNumerico
import pe.queseria.campo.ui.componentes.TextosPendientes
import pe.queseria.campo.ui.pin.DotPin
import pe.queseria.campo.ui.pin.EntradaPin

// ─── ViewModel ───────────────────────────────────────────────────────────────

/** B1: código del admin → cree su PIN → repita su PIN → activar. */
sealed class EtapaActivar {
    data class Codigo(val error: String? = null) : EtapaActivar()
    /**
     * [intento] cambia en cada vuelta: con dos errores iguales seguidos (1234 y luego 2345, "es una
     * secuencia") el estado sería igual, no se volvería a emitir y lo tecleado quedaría trabado en 4.
     */
    data class CrearPin(val error: String? = null, val intento: Int = 0) : EtapaActivar()
    data object RepetirPin : EtapaActivar()
    data object Cargando : EtapaActivar()
}

/**
 * Recibe la activación como función (y no el [Autenticador]) para poder probar las etapas en la JVM.
 * Los PIN viven solo aquí, en memoria, mientras dura el flujo.
 */
class ActivarViewModel(private val activar: suspend (codigo: String, pin: String) -> Unit) : ViewModel() {

    private val _etapa = MutableStateFlow<EtapaActivar>(EtapaActivar.Codigo())
    val etapa: StateFlow<EtapaActivar> = _etapa.asStateFlow()

    private val _codigo = MutableStateFlow("")
    val codigo: StateFlow<String> = _codigo.asStateFlow()

    private var pinNuevo = ""
    private var intentos = 0

    private fun crearPin(error: String? = null) {
        _etapa.value = EtapaActivar.CrearPin(error, ++intentos)
    }

    /** Como lo acepta el backend: mayúsculas, solo letras y dígitos, 8 caracteres. */
    fun escribirCodigo(texto: String) {
        _codigo.value = texto.uppercase().filter { it.isLetterOrDigit() }.take(LARGO_CODIGO)
        if (_etapa.value is EtapaActivar.Codigo) _etapa.value = EtapaActivar.Codigo()
    }

    fun siguiente() {
        if (_codigo.value.length == LARGO_CODIGO) crearPin()
    }

    fun cambiarCodigo() {
        pinNuevo = ""
        _etapa.value = EtapaActivar.Codigo()
    }

    /** 4.º dígito del PIN nuevo. Lo trivial se avisa aquí mismo, sin gastar el código. */
    fun pinCreado(pin: String) {
        ReglasPin.trivial(pin)?.let {
            crearPin(error = "Elija un PIN menos obvio: $it")
            return
        }
        pinNuevo = pin
        _etapa.value = EtapaActivar.RepetirPin
    }

    /** 4.º dígito de la repetición: si coincide, se activa. */
    fun pinRepetido(pin: String) {
        if (pin != pinNuevo) {
            pinNuevo = ""
            crearPin(error = "Los PIN no coinciden. Vuelva a crearlo")
            return
        }
        _etapa.value = EtapaActivar.Cargando
        viewModelScope.launch {
            try {
                activar(_codigo.value, pin)
                // Autenticador emite EstadoSesion.Abierta; MainActivity cambia de pantalla
            } catch (e: CancellationException) {
                throw e
            } catch (e: ErrorApp.Validacion) {
                // 422 del servidor: el PIN (p. ej. los últimos dígitos de su DNI). El código no se gastó.
                crearPin(error = e.message)
            } catch (e: ErrorApp) {
                // Código inválido o vencido, demasiados intentos, celular de otro usuario, sin red,
                // "Sincronice primero"...: se vuelve al código, que es lo que hay que revisar.
                _etapa.value = EtapaActivar.Codigo(error = e.message ?: "No se pudo vincular el celular")
            } catch (e: Exception) {
                _etapa.value = EtapaActivar.Codigo(error = "Error inesperado: ${e.message}")
            } finally {
                pinNuevo = ""
            }
        }
    }

    companion object {
        const val LARGO_CODIGO = 8

        fun factory(autenticador: Autenticador) = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>) =
                ActivarViewModel { codigo, pin -> autenticador.activar(codigo, pin) } as T
        }
    }
}

// ─── Pantalla ─────────────────────────────────────────────────────────────────

/**
 * @param motivo por qué se volvió a esta pantalla (el admin desvinculó el celular); null la primera vez.
 * @param entregasPendientes recolecciones guardadas sin enviar; se conservan para la próxima vinculación.
 * @param productoresPendientes altas de campo sin enviar; se conservan igual (y la leche las apunta).
 * @param onVolver vuelve al PIN sin activar (se llegó desde "¿Olvidó su PIN?"); null si no hay a dónde volver.
 */
@Composable
fun ActivarPantalla(
    autenticador: Autenticador,
    motivo: String? = null,
    entregasPendientes: Int = 0,
    productoresPendientes: Int = 0,
    onVolver: (() -> Unit)? = null,
) {
    val vm: ActivarViewModel = viewModel(factory = ActivarViewModel.factory(autenticador))
    val etapa by vm.etapa.collectAsStateWithLifecycle()
    val codigo by vm.codigo.collectAsStateWithLifecycle()
    val cargando = etapa is EtapaActivar.Cargando

    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Quesería Campo", style = MaterialTheme.typography.titleSmall,
             color = MaterialTheme.colorScheme.primary)

        when (val e = etapa) {
            is EtapaActivar.Codigo -> PasoCodigo(
                codigo = codigo,
                error = e.error,
                motivo = motivo,
                pendientes = TextosPendientes.contar(entregasPendientes, productoresPendientes),
                hayToken = autenticador.tokenVigente() != null,
                onEscribir = vm::escribirCodigo,
                onSiguiente = vm::siguiente,
            )

            is EtapaActivar.CrearPin -> PasoPin(
                titulo = "Cree su PIN",
                subtitulo = "${ReglasPin.LARGO} dígitos que solo usted conozca. Evite 1234, 0000 o su DNI.",
                error = e.error,
                clave = e,
                onCompleto = vm::pinCreado,
            )

            EtapaActivar.RepetirPin, EtapaActivar.Cargando -> PasoPin(
                titulo = "Repita su PIN",
                subtitulo = if (cargando) "Vinculando el celular…" else "Teclee el mismo PIN otra vez.",
                error = null,
                clave = EtapaActivar.RepetirPin,
                habilitado = !cargando,
                onCompleto = vm::pinRepetido,
            )
        }

        if (etapa !is EtapaActivar.Codigo) {
            BtnSecundario(texto = "Cambiar código", onClick = vm::cambiarCodigo, habilitado = !cargando)
        }
        onVolver?.let {
            BtnSecundario(texto = "Volver al PIN", onClick = it, habilitado = !cargando)
        }
    }
}

@Composable
private fun androidx.compose.foundation.layout.ColumnScope.PasoCodigo(
    codigo: String,
    error: String?,
    motivo: String?,
    pendientes: String?,
    hayToken: Boolean,
    onEscribir: (String) -> Unit,
    onSiguiente: () -> Unit,
) {
    val context = LocalContext.current
    Text("Vincular celular", style = MaterialTheme.typography.headlineMedium)

    motivo?.let { MensajeError(it) }
    // También las altas de productor: antes, con un alta pendiente y ninguna entrega, no se avisaba nada
    pendientes?.let {
        MensajeAviso("Quedan $it sin enviar. No se borran al vincular otra vez: se enviarán después.")
        // Con la sesión anterior aún vigente se puede enviar antes de reactivar
        if (hayToken) {
            BtnSecundario(texto = "Sincronizar ahora", onClick = { SyncWorker.sincronizarAhora(context) })
        }
    }

    Text(
        "Ingrese el código de ${ActivarViewModel.LARGO_CODIGO} caracteres que le entregó el administrador. " +
            "Vence en 60 minutos y sirve una sola vez.",
        style = MaterialTheme.typography.bodyLarge,
    )

    OutlinedTextField(
        value = codigo,
        onValueChange = onEscribir,
        label = { Text("Código de activación") },
        placeholder = { Text("XXXXXXXX") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(
            capitalization = KeyboardCapitalization.Characters,
            imeAction = ImeAction.Done,
        ),
        modifier = Modifier.fillMaxWidth(),
    )

    error?.let { MensajeError(it) }

    Spacer(Modifier.weight(1f))

    BtnPrimario(
        texto = "SIGUIENTE",
        onClick = onSiguiente,
        habilitado = codigo.length == ActivarViewModel.LARGO_CODIGO,
    )
}

/**
 * Teclado barajado para crear o repetir el PIN, sin OK: avanza solo al 4.º dígito ([EntradaPin]).
 * [clave] reinicia lo tecleado y vuelve a barajar en cada etapa (y tras cada error).
 */
@Composable
private fun androidx.compose.foundation.layout.ColumnScope.PasoPin(
    titulo: String,
    subtitulo: String,
    error: String?,
    clave: Any,
    onCompleto: (String) -> Unit,
    habilitado: Boolean = true,
) {
    var pin by rememberSaveable(clave) { mutableStateOf("") }

    Text(titulo, style = MaterialTheme.typography.headlineMedium)
    Text(subtitulo, style = MaterialTheme.typography.bodyLarge)
    Spacer(Modifier.height(8.dp))
    DotPin(pin.length, modifier = Modifier.align(Alignment.CenterHorizontally))
    error?.let { MensajeError(it) }

    Spacer(Modifier.weight(1f))

    TecladoNumerico(
        onDigito = { d ->
            val paso = EntradaPin.teclear(pin, d)
            pin = paso.pin
            if (paso.enviar) onCompleto(paso.pin)
        },
        onBorrar = { pin = EntradaPin.borrar(pin) },
        habilitado = habilitado,
        mezclar = true,
        claveMezcla = clave,
    )
}
