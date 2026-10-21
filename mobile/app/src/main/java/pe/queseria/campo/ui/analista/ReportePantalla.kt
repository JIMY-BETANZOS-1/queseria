package pe.queseria.campo.ui.analista

import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import pe.queseria.campo.BuildConfig
import pe.queseria.campo.datos.local.AnalistaDao
import pe.queseria.campo.datos.local.ProductorEntidad
import pe.queseria.campo.sync.FotoAnalisis
import pe.queseria.campo.ui.componentes.BtnPrimario
import pe.queseria.campo.ui.componentes.BtnSecundario
import pe.queseria.campo.ui.componentes.MensajeError
import java.io.File

/**
 * Reporte del analista sobre un productor: comentario, foto (cámara o galería, reducida) o ambos. Se guarda en el
 * celular aunque no haya señal; la foto se envía después con reintento. Solo informativo: sin valores de calidad.
 */
@Composable
fun ReportePantalla(
    clave: String,
    dao: AnalistaDao,
    fotos: FotoAnalisis,
    onGuardado: (String) -> Unit,
    onVolver: () -> Unit,
) {
    val productor by produceState<ProductorEntidad?>(null, clave) { value = dao.productor(clave) }
    val reportes by dao.observarReportes(clave).collectAsStateWithLifecycle(emptyList())
    var comentario by rememberSaveable(clave) { mutableStateOf("") }
    var fotoRuta by rememberSaveable(clave) { mutableStateOf<String?>(null) }
    var uriCamara by rememberSaveable { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var guardando by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val contexto = LocalContext.current

    fun guardarFoto(uri: Uri, temporal: File? = null) {
        scope.launch {
            try {
                val nueva = withContext(Dispatchers.IO) { fotos.guardarComprimida(uri) }
                fotoRuta?.let { File(it).delete() }          // reemplaza la anterior
                fotoRuta = nueva
                error = null
            } catch (e: Exception) {
                error = "No se pudo guardar la foto"
            } finally {
                temporal?.delete()
            }
        }
    }
    val galeria = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let { guardarFoto(it) }
    }
    val camara = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val temporal = uriCamara?.let { File(it) }
        if (ok && temporal != null) {
            guardarFoto(FileProvider.getUriForFile(contexto, "${BuildConfig.APPLICATION_ID}.fileprovider", temporal), temporal)
        } else {
            temporal?.delete()
        }
    }

    val nombre = productor?.nombre ?: ""
    Column(Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()),
           verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(nombre, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        productor?.let { p ->
            Text(listOfNotNull(p.codigo, if (p.rutaId == null) "Externo" else null, p.documento?.let { "DNI $it" })
                     .joinToString(" · "), style = MaterialTheme.typography.bodyMedium)
        }
        Text("Reporte informativo para el administrador: no registra calidad ni sanciones.",
             style = MaterialTheme.typography.bodyMedium)
        OutlinedTextField(
            comentario, { if (it.length <= Reportes.MAX_COMENTARIO) comentario = it },
            label = { Text("Comentario") }, minLines = 3, modifier = Modifier.fillMaxWidth(),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            BtnSecundario("Cámara", {
                val carpeta = File(contexto.cacheDir, "analisis").apply { mkdirs() }
                val archivo = File.createTempFile("captura-", ".jpg", carpeta)
                uriCamara = archivo.absolutePath
                camara.launch(FileProvider.getUriForFile(contexto, "${BuildConfig.APPLICATION_ID}.fileprovider", archivo))
            }, Modifier.weight(1f))
            BtnSecundario("Galería", { galeria.launch("image/*") }, Modifier.weight(1f))
        }
        fotoRuta?.let { ruta ->
            val imagen = remember(ruta) { BitmapFactory.decodeFile(ruta)?.asImageBitmap() }
            imagen?.let {
                Image(it, contentDescription = "Foto del reporte", contentScale = ContentScale.Fit,
                      modifier = Modifier.fillMaxWidth().heightIn(max = 260.dp))
            }
            BtnSecundario("Quitar la foto", {
                File(ruta).delete()
                fotoRuta = null
            })
        }
        if (comentario.isNotBlank()) {
            Text("El comentario queda en este celular: el servidor todavía no tiene dónde guardarlo.",
                 style = MaterialTheme.typography.bodySmall)
        }
        error?.let { MensajeError(it) }
        BtnPrimario("Guardar reporte", {
            val problema = Reportes.validar(comentario, fotoRuta)
            if (problema != null) {
                error = problema
                return@BtnPrimario
            }
            scope.launch {
                guardando = true
                try {
                    dao.insertarReporte(Reportes.nuevo(clave, nombre, comentario, fotoRuta, System.currentTimeMillis()))
                    onGuardado(if (fotoRuta != null) "✓ Reporte guardado: se enviará la foto de $nombre"
                               else "✓ Comentario guardado en el celular: $nombre")
                } catch (e: Exception) {
                    error = "No se pudo guardar el reporte"
                } finally {
                    guardando = false
                }
            }
        }, cargando = guardando, habilitado = productor != null)
        BtnSecundario("Volver", onVolver)

        if (reportes.isNotEmpty()) {
            Text("Reportes anteriores", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            reportes.forEach { r ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(Reportes.fechaHora(r.creadoEnMs) + if (r.fotoRuta != null) " · con foto" else "",
                             fontWeight = FontWeight.SemiBold)
                        r.comentario?.let { Text(it) }
                        Text(Reportes.textoEstado(r), style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}
