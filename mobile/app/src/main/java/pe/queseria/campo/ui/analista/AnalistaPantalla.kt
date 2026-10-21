package pe.queseria.campo.ui.analista

import androidx.activity.compose.BackHandler
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
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import pe.queseria.campo.AppContainer
import pe.queseria.campo.datos.local.EstadoSync
import pe.queseria.campo.datos.local.ProductorAnalistaFila
import pe.queseria.campo.ui.componentes.BtnPrimario
import pe.queseria.campo.ui.componentes.BtnSecundario
import pe.queseria.campo.ui.componentes.MensajeAviso
import pe.queseria.campo.ui.componentes.MensajeError
import pe.queseria.campo.sync.SyncWorker

private const val LISTA = "lista"
private const val NUEVO = "nuevo"
private const val REPORTE = "reporte:"

/**
 * App del analista (0.8.0): productores de todas las rutas y externos; al tocar uno, un reporte informativo
 * (comentario, foto o ambos) que se guarda sin señal. Alta de productores externos. No sincroniza entregas.
 */
@Composable
fun AppAnalista(contenedor: AppContainer, nombre: String) {
    var destino by rememberSaveable { mutableStateOf(LISTA) }
    var aviso by rememberSaveable { mutableStateOf<String?>(null) }
    val contexto = LocalContext.current

    when {
        destino == NUEVO -> NuevoExternoPantalla(
            dao = contenedor.base.syncDao(),
            registrador = contenedor.registrador,
            onCreado = { nombreNuevo ->
                SyncWorker.sincronizarAhora(contexto)
                aviso = "✓ Productor externo guardado: $nombreNuevo"
                destino = LISTA
            },
            onCancelar = { destino = LISTA },
        )

        destino.startsWith(REPORTE) -> ReportePantalla(
            clave = destino.removePrefix(REPORTE),
            dao = contenedor.analistaDao,
            fotos = contenedor.fotoAnalisis,
            onGuardado = { texto ->
                SyncWorker.sincronizarAhora(contexto)
                aviso = texto
                destino = LISTA
            },
            onVolver = { destino = LISTA },
        )

        else -> ListaProductores(
            contenedor = contenedor,
            nombreAnalista = nombre,
            aviso = aviso,
            onTocar = { clave ->
                aviso = null
                destino = REPORTE + clave
            },
            onNuevo = {
                aviso = null
                destino = NUEVO
            },
        )
    }
    BackHandler(enabled = destino != LISTA) { destino = LISTA }
}

@Composable
private fun ListaProductores(
    contenedor: AppContainer,
    nombreAnalista: String,
    aviso: String?,
    onTocar: (String) -> Unit,
    onNuevo: () -> Unit,
) {
    val dao = contenedor.analistaDao
    val productores by dao.observarProductores().collectAsStateWithLifecycle(emptyList())
    val porEnviar by dao.observarPorEnviar().collectAsStateWithLifecycle(0)
    val rechazadas by dao.observarAltasRechazadas().collectAsStateWithLifecycle(emptyList())
    var busqueda by rememberSaveable { mutableStateOf("") }
    var sincronizando by remember { mutableStateOf(false) }
    var resultado by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    fun sincronizar() {
        scope.launch {
            sincronizando = true
            error = null
            resultado = null
            try {
                val r = contenedor.motorSync.sincronizar()
                resultado = if (r.reportesEnviados > 0) "✓ Sincronizado · ${r.reportesEnviados} foto(s) enviada(s)"
                            else "✓ Sincronizado"
            } catch (e: Exception) {
                error = e.message ?: "No se pudo sincronizar. Se reintentará solo"
            } finally {
                sincronizando = false
            }
        }
    }
    // Al abrir: baja la lista (si no hay señal, se trabaja con lo guardado)
    LaunchedEffect(Unit) { sincronizar() }

    val filas = productores.filter { Reportes.coincide(busqueda, it.nombre, it.codigo, it.documento) }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Productores", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Text("Analista: $nombreAnalista", style = MaterialTheme.typography.bodyMedium)
        aviso?.let { MensajeAviso(it) }
        BtnPrimario("Nuevo productor externo", onNuevo)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            BtnSecundario(if (porEnviar > 0) "Sincronizar ($porEnviar por enviar)" else "Sincronizar",
                          ::sincronizar, Modifier.weight(1f), habilitado = !sincronizando)
        }
        resultado?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        error?.let { MensajeError(it) }
        rechazadas.forEach { MensajeError("No se pudo dar de alta a ${it.nombre}: ${it.motivo ?: "sin motivo"}") }
        OutlinedTextField(busqueda, { busqueda = it }, label = { Text("Buscar por nombre, código o DNI") },
                          singleLine = true, modifier = Modifier.fillMaxWidth())
        if (filas.isEmpty()) {
            Text(if (productores.isEmpty()) "Todavía no hay productores en este celular. Sincronice con señal."
                 else "Ningún productor coincide con la búsqueda.")
        }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(filas, key = { it.clave }) { p -> FilaProductor(p) { onTocar(p.clave) } }
        }
    }
}

@Composable
private fun FilaProductor(p: ProductorAnalistaFila, onClick: () -> Unit) {
    Card(Modifier.fillMaxWidth().heightIn(min = 72.dp).clickable(onClick = onClick)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(p.nombre, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            val donde = listOfNotNull(
                p.rutaNombre ?: "Externo",
                p.codigo ?: if (p.estadoSync == EstadoSync.PENDIENTE) "por subir" else null,
                if (!p.aprobado) "alta pendiente de aprobación" else null,
            ).joinToString(" · ")
            Text(donde, style = MaterialTheme.typography.bodyMedium)
            val marcas = listOfNotNull(
                when {
                    p.bloqueado -> "Bloqueado hoy"
                    p.sancionado -> "Con sanción de precio"
                    else -> null
                },
                if (p.nReportes > 0) "${p.nReportes} reporte(s)" else null,
                if (p.nPorEnviar > 0) "${p.nPorEnviar} foto(s) por enviar" else null,
            )
            if (marcas.isNotEmpty()) {
                Text(marcas.joinToString(" · "), style = MaterialTheme.typography.bodyMedium,
                     color = if (p.bloqueado) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
            }
        }
    }
}
