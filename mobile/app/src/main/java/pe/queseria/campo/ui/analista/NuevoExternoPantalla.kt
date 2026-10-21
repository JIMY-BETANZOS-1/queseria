package pe.queseria.campo.ui.analista

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import pe.queseria.campo.datos.local.SyncDao
import pe.queseria.campo.registro.Registrador
import pe.queseria.campo.ui.componentes.BtnPrimario
import pe.queseria.campo.ui.componentes.BtnSecundario
import pe.queseria.campo.ui.componentes.MensajeAviso
import pe.queseria.campo.ui.componentes.MensajeError
import pe.queseria.campo.ui.productor.AltaProductor

/**
 * Alta de un productor externo desde el celular del analista (sin señal): nombre o empresa, DNI (o RUC) y
 * celular. Queda como externo; la API fija el tipo por el rol y lo sube antes que cualquier reporte suyo.
 */
@Composable
fun NuevoExternoPantalla(
    dao: SyncDao,
    registrador: Registrador,
    onCreado: (String) -> Unit,
    onCancelar: () -> Unit,
) {
    var nombre by rememberSaveable { mutableStateOf("") }
    var documento by rememberSaveable { mutableStateOf("") }
    var celular by rememberSaveable { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var parecido by remember { mutableStateOf<String?>(null) }
    var guardando by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Column(Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()),
           verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Nuevo productor externo", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Text("Llega directo a la planta (no pertenece a una ruta).", style = MaterialTheme.typography.bodyMedium)
        OutlinedTextField(nombre, { nombre = it; parecido = null }, label = { Text("Nombre o empresa") },
                          singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(documento, { documento = it.filter(Char::isDigit).take(11); parecido = null },
                          label = { Text("DNI (o RUC si es empresa)") }, singleLine = true,
                          keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                          modifier = Modifier.fillMaxWidth())
        OutlinedTextField(celular, { celular = it.filter(Char::isDigit).take(9) }, label = { Text("Celular") },
                          singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                          modifier = Modifier.fillMaxWidth())
        parecido?.let { MensajeAviso(it) }
        error?.let { MensajeError(it) }
        BtnPrimario(if (parecido != null) "Guardar de todos modos" else "Guardar productor", {
            error = Reportes.validarExterno(nombre, documento, celular)
            if (error != null) return@BtnPrimario
            scope.launch {
                guardando = true
                try {
                    val dup = AltaProductor.posibleDuplicado(nombre, documento, dao.productoresLocales())
                    when {
                        // El DNI es UNIQUE en la base: crearlo de nuevo acabaría rechazado
                        dup != null && dup.porDocumento -> error = AltaProductor.textoDuplicado(dup)
                        dup != null && parecido == null -> parecido = AltaProductor.textoDuplicado(dup)
                        else -> {
                            val p = registrador.crearProductorExterno(nombre, documento, celular)
                            onCreado(p.nombre)
                        }
                    }
                } catch (e: Exception) {
                    error = "No se pudo guardar el productor"
                } finally {
                    guardando = false
                }
            }
        }, cargando = guardando)
        BtnSecundario("Cancelar", onCancelar)
    }
}
