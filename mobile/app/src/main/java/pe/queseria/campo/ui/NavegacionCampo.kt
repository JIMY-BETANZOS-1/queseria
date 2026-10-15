package pe.queseria.campo.ui

import androidx.activity.compose.BackHandler
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.mapSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import pe.queseria.campo.AppContainer
import pe.queseria.campo.seguridad.EstadoSesion
import pe.queseria.campo.ui.inicio.InicioPantalla
import pe.queseria.campo.ui.productor.NuevoProductorPantalla
import pe.queseria.campo.ui.registro.RegistrarPantalla

private const val K_DESTINO = "destino"
private const val K_AVISO = "aviso"
private const val K_CONFIRMAR = "confirmar"
private const val K_CLAVE = "clave"

private val SAVER = mapSaver(
    save = { d ->
        when (d) {
            is Destino.Inicio -> mapOf(K_DESTINO to "inicio", K_AVISO to d.aviso, K_CONFIRMAR to d.confirmar)
            is Destino.Registrar -> mapOf(K_DESTINO to "registrar", K_CLAVE to d.claveProductor)
            Destino.NuevoProductor -> mapOf(K_DESTINO to "nuevo")
        }
    },
    restore = { m ->
        when (m[K_DESTINO]) {
            "registrar" -> Destino.Registrar(m[K_CLAVE] as String)
            "nuevo" -> Destino.NuevoProductor
            else -> Destino.Inicio(m[K_AVISO] as String?, m[K_CONFIRMAR] as String?)
        }
    },
)

@Composable
fun AppAcopiador(contenedor: AppContainer, sesion: EstadoSesion.Abierta) {
    var destino by rememberSaveable(stateSaver = SAVER) { mutableStateOf<Destino>(Destino.Inicio()) }
    val dao = contenedor.base.syncDao()

    when (val d = destino) {
        is Destino.Inicio -> InicioPantalla(
            dao = dao,
            miDia = contenedor.miDia,
            nombreAcopiador = sesion.usuario.nombre,
            conServidor = sesion.conServidor,
            avisoPinPendiente = Rumbo.avisoPinPendiente(sesion),
            aviso = d.aviso,
            confirmar = d.confirmar,
            onTocarProductor = { destino = Rumbo.alTocarProductor(it) },
            onConfirmarOtraEntrega = { destino = Rumbo.alConfirmarOtraEntrega(destino) },
            onCancelarConfirmacion = { destino = Rumbo.alCancelarConfirmacion(destino) },
            onNuevoProductor = { destino = Destino.NuevoProductor },
        )

        is Destino.Registrar -> RegistrarPantalla(
            claveProductor = d.claveProductor,
            dao = dao,
            registrador = contenedor.registrador,
            ubicador = contenedor.ubicador,
            onGuardado = { litros, productor ->
                destino = Rumbo.alGuardar(destino, d.claveProductor, "✓ Registrado: $litros L · $productor")
            },
            onCancelar = { destino = Destino.Inicio() },
        )

        Destino.NuevoProductor -> NuevoProductorPantalla(
            dao = dao,
            registrador = contenedor.registrador,
            // Recién creado: B4 directo, que es para lo que el acopiador lo dio de alta
            onCreado = { clave -> destino = Rumbo.alCrearProductor(clave) },
            onUsarExistente = { clave -> destino = Rumbo.alCrearProductor(clave) },
            onCancelar = { destino = Destino.Inicio() },
        )
    }

    // Habilitado también mientras está abierto el aviso de "otra entrega": así no hay salto
    // deshabilitado → habilitado al entrar a B4 (ver Rumbo.atras).
    val atras = Rumbo.atras(destino)
    BackHandler(enabled = atras != null) { atras?.let { destino = it } }
}
