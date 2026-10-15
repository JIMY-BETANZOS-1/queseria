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
import pe.queseria.campo.ui.registro.RegistrarPantalla

/**
 * Pantallas del acopiador una vez abierta la sesión. Son pocas y el paso entre ellas es lineal, así
 * que se resuelve con un estado guardado en lugar de añadir una librería de navegación.
 */
sealed class Destino {
    /** [aviso] = confirmación que deja B4 al volver ("✓ Registrado: 23.50 L · Juana Mamani"). */
    data class Inicio(val aviso: String? = null) : Destino()
    data class Registrar(val claveProductor: String) : Destino()
}

private const val K_DESTINO = "destino"
private const val K_AVISO = "aviso"
private const val K_CLAVE = "clave"

private val SAVER = mapSaver(
    save = { d ->
        when (d) {
            is Destino.Inicio -> mapOf(K_DESTINO to "inicio", K_AVISO to d.aviso)
            is Destino.Registrar -> mapOf(K_DESTINO to "registrar", K_CLAVE to d.claveProductor)
        }
    },
    restore = { m ->
        when (m[K_DESTINO]) {
            "registrar" -> Destino.Registrar(m[K_CLAVE] as String)
            else -> Destino.Inicio(m[K_AVISO] as String?)
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
            aviso = d.aviso,
            onRegistrar = { destino = Destino.Registrar(it.clave) },
        )

        is Destino.Registrar -> RegistrarPantalla(
            claveProductor = d.claveProductor,
            dao = dao,
            registrador = contenedor.registrador,
            ubicador = contenedor.ubicador,
            onGuardado = { litros, productor ->
                destino = Destino.Inicio("✓ Registrado: $litros L · $productor")
            },
            onCancelar = { destino = Destino.Inicio() },
        )
    }

    BackHandler(enabled = destino !is Destino.Inicio) { destino = Destino.Inicio() }
}
