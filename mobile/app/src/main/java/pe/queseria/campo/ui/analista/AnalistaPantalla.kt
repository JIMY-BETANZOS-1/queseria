package pe.queseria.campo.ui.analista

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import android.content.Context
import android.net.Uri
import androidx.compose.material3.TextButton
import pe.queseria.campo.BuildConfig
import pe.queseria.campo.datos.local.AnalistaDao
import pe.queseria.campo.datos.local.EntregaAnalistaEntidad
import pe.queseria.campo.datos.local.RevisionCalidadEntidad
import pe.queseria.campo.registro.Registrador
import pe.queseria.campo.datos.local.SyncDao
import pe.queseria.campo.sync.MotorSync
import pe.queseria.campo.sync.FotoAnalisis
import java.io.File
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.launch

private val LIMA = ZoneId.of("America/Lima")

@Composable
fun AppAnalista(
    dao: AnalistaDao,
    syncDao: SyncDao,
    registrador: Registrador,
    motor: MotorSync,
    fotos: FotoAnalisis,
    nombre: String,
) {
    val hoy = LocalDate.now(LIMA)
    val desde = hoy.atStartOfDay(LIMA).toInstant().toEpochMilli()
    val hasta = hoy.plusDays(1).atStartOfDay(LIMA).toInstant().toEpochMilli()
    val entregas by dao.observarEntregas(desde, hasta).collectAsStateWithLifecycle(emptyList())
    var error by remember { mutableStateOf<String?>(null) }
    var externo by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        try {
            motor.sincronizar()
        } catch (e: Exception) {
            error = e.message ?: "No se pudo sincronizar"
        }
    }
    if (externo) {
        ProductorExternoPantalla(syncDao, dao, registrador, fotos) { externo = false }
        return
    }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Entregas del día")
        Text("Analista: $nombre")
        Button(onClick = { externo = true }) { Text("Productor externo") }
        Button(onClick = {
            scope.launch {
            error = null
            try {
                motor.sincronizar()
            } catch (e: Exception) {
                error = e.message ?: "No se pudo sincronizar"
            }
            }
        }) { Text("Sincronizar") }
        error?.let { Text(it) }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(entregas, key = { it.id }) { entrega ->
                EntregaAnalistaCard(entrega, dao, fotos)
            }
        }
    }
}

@Composable
private fun EntregaAnalistaCard(entrega: EntregaAnalistaEntidad, dao: AnalistaDao, fotos: FotoAnalisis) {
    var abierto by remember(entrega.id) { mutableStateOf(false) }
    var ph by remember(entrega.id) { mutableStateOf("") }
    var temperatura by remember(entrega.id) { mutableStateOf("") }
    var grasa by remember(entrega.id) { mutableStateOf("") }
    var densidad by remember(entrega.id) { mutableStateOf("") }
    var antibioticos by remember(entrega.id) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val contexto = LocalContext.current
    var fotoLocal by remember(entrega.id, entrega.fotoUrl) { mutableStateOf(entrega.fotoUrl) }
    var errorFoto by remember(entrega.id) { mutableStateOf<String?>(null) }
    var uriCamara by remember { mutableStateOf<Uri?>(null) }
    val guardarFoto: (Uri) -> Unit = { uri ->
        scope.launch {
            try {
                fotoLocal = fotos.guardarComprimida(uri)
                errorFoto = null
            } catch (_: Exception) {
                fotoLocal = null
                errorFoto = "No se pudo guardar la foto"
            }
        }
    }
    val galeria = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let(guardarFoto)
    }
    val camara = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        if (ok) uriCamara?.let(guardarFoto)
    }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text("${entrega.productor} · ${entrega.litros} L")
            Text("Acopiador: ${entrega.acopiador ?: "Externo"}")
            Text("Calidad: ${entrega.estadoCalidad.uppercase()}")
            if (!entrega.revisada || abierto) {
                Row {
                    RadioButton(selected = !abierto, onClick = {
                        abierto = false
                        scope.launch { guardarNormal(dao, entrega) }
                    })
                    Text("Normal")
                    RadioButton(selected = abierto, onClick = { abierto = true })
                    Text("Alterada")
                }
            }
            if (!entrega.revisada && !abierto) {
                Button(onClick = { scope.launch { guardarNormal(dao, entrega) } }) { Text("Confirmar normal") }
                Button(onClick = { abierto = true }) { Text("Marcar alterada") }
            }
            if (abierto) {
                Campo("pH", ph) { ph = it }
                Campo("Temperatura", temperatura) { temperatura = it }
                Campo("Grasa %", grasa) { grasa = it }
                Campo("Densidad", densidad) { densidad = it }
                Row {
                    androidx.compose.material3.Checkbox(antibioticos, { antibioticos = it })
                    Text("Antibióticos positivos")
                }
                Text("Foto opcional")
                Row {
                    TextButton(onClick = { galeria.launch("image/*") }) { Text("Galería") }
                    TextButton(onClick = {
                        val carpeta = File(contexto.cacheDir, "analisis").apply { mkdirs() }
                        val archivo = File.createTempFile("captura-", ".jpg", carpeta)
                        uriCamara = FileProvider.getUriForFile(
                            contexto, "${BuildConfig.APPLICATION_ID}.fileprovider", archivo,
                        )
                        camara.launch(requireNotNull(uriCamara))
                    }) { Text("Cámara") }
                }
                fotoLocal?.let { Text("Foto guardada para sincronizar") }
                errorFoto?.let { Text(it) }
                Button(onClick = {
                    scope.launch {
                        dao.guardarRevision(RevisionCalidadEntidad(
                            entrega.id, "alterado", ph.takeIf(String::isNotBlank),
                            temperatura.takeIf(String::isNotBlank), grasa.takeIf(String::isNotBlank),
                            densidad.takeIf(String::isNotBlank), antibioticos, fotoLocal,
                        ))
                        dao.guardarResultadoLocal(entrega.id, "alterado", ph.toDoubleOrNull(),
                            temperatura.toDoubleOrNull(), grasa.toDoubleOrNull(), densidad.toDoubleOrNull(), antibioticos)
                    }
                    abierto = false
                }) { Text("Guardar alterada") }
            }
        }
    }
}

@Composable
private fun Campo(etiqueta: String, valor: String, cambio: (String) -> Unit) {
    OutlinedTextField(valor, cambio, label = { Text(etiqueta) }, singleLine = true,
        modifier = Modifier.fillMaxWidth())
}

private suspend fun guardarNormal(dao: AnalistaDao, entrega: EntregaAnalistaEntidad) {
    dao.guardarRevision(RevisionCalidadEntidad(entrega.id, "normal", null, null, null, null, null))
    dao.guardarResultadoLocal(entrega.id, "normal", null, null, null, null, null)
}
