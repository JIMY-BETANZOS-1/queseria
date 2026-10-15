package pe.queseria.campo.ui.productor

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import pe.queseria.campo.datos.local.ProductorEntidad
import pe.queseria.campo.datos.local.RutaEntidad
import pe.queseria.campo.datos.local.SyncDao
import pe.queseria.campo.registro.Registrador
import pe.queseria.campo.ui.componentes.BtnPrimario
import pe.queseria.campo.ui.componentes.BtnSecundario
import pe.queseria.campo.ui.componentes.MensajeAviso
import pe.queseria.campo.ui.componentes.MensajeError

// ─── ViewModel ───────────────────────────────────────────────────────────────

data class Formulario(
    val nombre: String = "",
    val documento: String = "",
    val celular: String = "",
    val rutaId: Long? = null,
    val error: String? = null,
    /** Coincidencia con un productor que ya está en el celular; se confirma antes de crear. */
    val duplicado: Duplicado? = null,
)

/**
 * B5. Recibe los dos colaboradores como funciones y no como [SyncDao] / [Registrador] porque el
 * Registrador necesita Room y el Keystore: así el aviso de duplicado se puede probar en la JVM, que es
 * justo donde estaba el fallo (la lista contra la que se comparaba llegaba vacía).
 */
class NuevoProductorViewModel(
    rutas: Flow<List<RutaEntidad>>,
    private val leerLocales: suspend () -> List<ProductorEntidad>,
    private val crear: suspend (String, String?, String?, Long) -> ProductorEntidad,
) : ViewModel() {

    private val _formulario = MutableStateFlow(Formulario())
    val formulario: StateFlow<Formulario> = _formulario.asStateFlow()

    private val _guardando = MutableStateFlow(false)
    val guardando: StateFlow<Boolean> = _guardando.asStateFlow()

    /** La pantalla sí se suscribe a esto, y `prepararRuta` corre desde su LaunchedEffect. */
    val rutas: StateFlow<List<RutaEntidad>> =
        rutas.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    /** Con una sola ruta no se pregunta nada: se elige sola. */
    fun prepararRuta() {
        val unica = rutas.value.singleOrNull() ?: return
        if (_formulario.value.rutaId == null) _formulario.value = _formulario.value.copy(rutaId = unica.id)
    }

    fun escribirNombre(v: String) = editar { it.copy(nombre = v) }
    fun escribirDocumento(v: String) = editar { it.copy(documento = v.filter(Char::isDigit).take(11)) }
    fun escribirCelular(v: String) = editar { it.copy(celular = v.filter(Char::isDigit).take(9)) }
    fun elegirRuta(id: Long) = editar { it.copy(rutaId = id) }

    /** Al tocar cualquier campo se borran el error y el aviso de duplicado ya resuelto. */
    private fun editar(cambio: (Formulario) -> Formulario) {
        _formulario.value = cambio(_formulario.value).copy(error = null, duplicado = null)
    }

    /**
     * Primer toque: valida y, si huele a duplicado, avisa sin crear nada. El segundo toque
     * ("Crear igual") ya trae [forzar] y guarda: el aviso informa, nunca impide el alta.
     */
    fun guardar(forzar: Boolean = false, onCreado: (String) -> Unit) {
        val f = _formulario.value
        AltaProductor.validar(f.nombre, f.documento, f.celular, f.rutaId)?.let { error ->
            _formulario.value = f.copy(error = error, duplicado = null)
            return
        }
        if (_guardando.value) return
        _guardando.value = true
        viewModelScope.launch {
            try {
                // La lista se lee aquí, en el momento de decidir, y no de un StateFlow: uno sin
                // suscriptor se queda en su valor inicial y el aviso no se activaba nunca.
                val duplicado =
                    if (forzar) null
                    else AltaProductor.posibleDuplicado(f.nombre, f.documento, leerLocales())

                if (duplicado != null) {
                    _formulario.value = _formulario.value.copy(duplicado = duplicado, error = null)
                    return@launch
                }
                val p = crear(f.nombre, f.documento, f.celular, requireNotNull(f.rutaId))
                onCreado(p.clave)
            } catch (e: Exception) {
                _formulario.value = _formulario.value.copy(
                    error = e.message ?: "No se pudo guardar el productor",
                )
            } finally {
                _guardando.value = false
            }
        }
    }

    companion object {
        fun factory(dao: SyncDao, registrador: Registrador) = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>) = NuevoProductorViewModel(
                rutas = dao.observarRutas(),
                leerLocales = dao::productoresLocales,
                crear = registrador::crearProductorCampo,
            ) as T
        }
    }
}

// ─── B5: alta de productor en el campo ───────────────────────────────────────

private val SOLO_NUMEROS = KeyboardOptions(keyboardType = KeyboardType.Number)

@Composable
fun NuevoProductorPantalla(
    dao: SyncDao,
    registrador: Registrador,
    onCreado: (String) -> Unit,
    onUsarExistente: (String) -> Unit,
    onCancelar: () -> Unit,
) {
    val vm: NuevoProductorViewModel = viewModel(factory = NuevoProductorViewModel.factory(dao, registrador))
    val f by vm.formulario.collectAsStateWithLifecycle()
    val rutas by vm.rutas.collectAsStateWithLifecycle()
    val guardando by vm.guardando.collectAsStateWithLifecycle()

    LaunchedEffect(rutas) { vm.prepararRuta() }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Productor nuevo", style = MaterialTheme.typography.headlineSmall)

        // La leche se recibe igual; lo que espera es el pago (db/schema.sql, v_recoleccion_pago.retenida)
        MensajeAviso(
            "Nace no aprobado: su leche se recibe, pero el pago queda retenido hasta que el " +
                "administrador lo apruebe.",
        )

        OutlinedTextField(
            value = f.nombre,
            onValueChange = vm::escribirNombre,
            label = { Text("Nombre y apellidos") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = f.documento,
            onValueChange = vm::escribirDocumento,
            label = { Text("DNI o RUC (opcional)") },
            singleLine = true,
            keyboardOptions = SOLO_NUMEROS,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = f.celular,
            onValueChange = vm::escribirCelular,
            label = { Text("Celular (opcional)") },
            singleLine = true,
            keyboardOptions = SOLO_NUMEROS,
            modifier = Modifier.fillMaxWidth(),
        )

        SelectorRuta(rutas = rutas, elegida = f.rutaId, onElegir = vm::elegirRuta)

        f.error?.let { MensajeError(it) }

        f.duplicado?.let { d ->
            PanelDuplicado(
                texto = AltaProductor.textoDuplicado(d),
                porDocumento = d.porDocumento,
                onUsar = { onUsarExistente(d.productor.clave) },
                onCrearIgual = { vm.guardar(forzar = true, onCreado = onCreado) },
            )
        }

        if (f.duplicado == null) {
            BtnPrimario(
                texto = "GUARDAR PRODUCTOR",
                onClick = { vm.guardar(onCreado = onCreado) },
                habilitado = rutas.isNotEmpty(),
                cargando = guardando,
            )
        }
        BtnSecundario(texto = "Cancelar", onClick = onCancelar, habilitado = !guardando)
    }
}

@Composable
private fun SelectorRuta(rutas: List<RutaEntidad>, elegida: Long?, onElegir: (Long) -> Unit) {
    when {
        rutas.isEmpty() -> MensajeError("Todavía no se bajó su ruta. Conéctese y toque Sincronizar.")

        rutas.size == 1 -> Text(
            "Ruta: ${rutas.first().nombre}",
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(top = 4.dp),
        )

        else -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Ruta", style = MaterialTheme.typography.titleMedium)
            rutas.forEach { ruta ->
                FilterChip(
                    selected = ruta.id == elegida,
                    onClick = { onElegir(ruta.id) },
                    label = { Text(ruta.nombre, style = MaterialTheme.typography.titleMedium) },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
                )
            }
        }
    }
}

/**
 * Aviso de posible duplicado. Nunca impide el alta: lo único que cambia es qué botón manda.
 * Con el DNI repetido (UNIQUE en la base) crear otro acaba seguro en rechazo, así que ahí el principal
 * es usar el que ya existe; si solo coincide el nombre, los homónimos son normales y manda "crear igual".
 */
@Composable
private fun PanelDuplicado(
    texto: String,
    porDocumento: Boolean,
    onUsar: () -> Unit,
    onCrearIgual: () -> Unit,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                "¿Es este productor?",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSecondaryContainer,
            )
            Text(
                texto,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSecondaryContainer,
            )
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (porDocumento) {
                    BtnPrimario("USAR ESE PRODUCTOR", onUsar, Modifier.weight(1f))
                    BtnSecundario("Crear igual", onCrearIgual, Modifier.weight(1f))
                } else {
                    BtnPrimario("CREAR IGUAL", onCrearIgual, Modifier.weight(1f))
                    BtnSecundario("Usar ese productor", onUsar, Modifier.weight(1f))
                }
            }
        }
    }
}
