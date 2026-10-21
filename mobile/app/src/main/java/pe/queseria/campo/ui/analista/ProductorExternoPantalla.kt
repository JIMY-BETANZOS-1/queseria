package pe.queseria.campo.ui.analista

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import pe.queseria.campo.registro.NuevaRecoleccion
import pe.queseria.campo.registro.Registrador
import pe.queseria.campo.datos.local.SyncDao
import pe.queseria.campo.datos.local.AnalistaDao
import pe.queseria.campo.datos.local.RevisionCalidadEntidad
import java.math.BigDecimal

@Composable
fun ProductorExternoPantalla(
    dao: SyncDao,
    analistaDao: AnalistaDao,
    registrador: Registrador,
    onVolver: () -> Unit,
) {
    var nombre by remember { mutableStateOf("") }
    var dni by remember { mutableStateOf("") }
    var celular by remember { mutableStateOf("") }
    var litros by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var alterada by remember { mutableStateOf(false) }
    var ph by remember { mutableStateOf("") }
    var temperatura by remember { mutableStateOf("") }
    var grasa by remember { mutableStateOf("") }
    var densidad by remember { mutableStateOf("") }
    var antibioticos by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Productor externo")
        OutlinedTextField(nombre, { nombre = it }, label = { Text("Nombre o empresa") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(dni, { dni = it }, label = { Text("DNI o RUC") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(celular, { celular = it }, label = { Text("Celular") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(litros, { litros = it }, label = { Text("Litros") }, modifier = Modifier.fillMaxWidth())
        Button(onClick = { alterada = !alterada }) {
            Text(if (alterada) "Calidad alterada" else "Calidad normal")
        }
        if (alterada) {
            OutlinedTextField(ph, { ph = it }, label = { Text("pH") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(temperatura, { temperatura = it }, label = { Text("Temperatura") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(grasa, { grasa = it }, label = { Text("Grasa %") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(densidad, { densidad = it }, label = { Text("Densidad") }, modifier = Modifier.fillMaxWidth())
            androidx.compose.material3.Checkbox(antibioticos, { antibioticos = it })
            Text("Antibióticos positivos")
        }
        error?.let { Text(it) }
        Button(onClick = {
            val cantidad = litros.toBigDecimalOrNull()
            if (nombre.isBlank() || cantidad == null || cantidad <= BigDecimal.ZERO) {
                error = "Ingrese nombre y litros válidos"
                return@Button
            }
            scope.launch {
                try {
                    val p = registrador.crearProductorExterno(nombre, dni, celular)
                    val entrega = registrador.registrar(NuevaRecoleccion(
                        productorId = null, productorUuidCliente = p.uuidCliente,
                        productorNombre = p.nombre, litros = cantidad, observacion = null,
                        ubicacion = null, horaAutomatica = true,
                    ))
                    if (alterada) {
                        analistaDao.guardarRevision(RevisionCalidadEntidad(
                            entrega.id, "alterado", ph, temperatura, grasa, densidad, antibioticos,
                        ))
                    }
                    onVolver()
                } catch (e: Exception) {
                    error = e.message ?: "No se pudo guardar la entrega"
                }
            }
        }) { Text("Guardar entrega") }
        Button(onClick = onVolver) { Text("Volver") }
    }
}
