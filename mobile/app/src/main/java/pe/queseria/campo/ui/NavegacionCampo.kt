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
import pe.queseria.campo.ui.dia.MiDiaPantalla
import pe.queseria.campo.ui.dia.UltimosDiasPantalla
import pe.queseria.campo.ui.inicio.InicioPantalla
import pe.queseria.campo.ui.productor.NuevoProductorPantalla
import pe.queseria.campo.ui.registro.RegistrarPantalla
import pe.queseria.campo.ui.sync.SyncPantalla
import java.time.LocalDate

private const val K_DESTINO = "destino"
private const val K_AVISO = "aviso"
private const val K_CONFIRMAR = "confirmar"
private const val K_CLAVE = "clave"
private const val K_FECHA = "fecha"

private val SAVER = mapSaver(
    save = { d ->
        when (d) {
            is Destino.Inicio -> mapOf(K_DESTINO to "inicio", K_AVISO to d.aviso, K_CONFIRMAR to d.confirmar)
            is Destino.Registrar -> mapOf(K_DESTINO to "registrar", K_CLAVE to d.claveProductor)
            Destino.NuevoProductor -> mapOf(K_DESTINO to "nuevo")
            Destino.MiDia -> mapOf(K_DESTINO to "midia")
            Destino.UltimosDias -> mapOf(K_DESTINO to "ultimos")
            is Destino.DiaAnterior -> mapOf(K_DESTINO to "dia", K_FECHA to d.fecha)
            Destino.Sync -> mapOf(K_DESTINO to "sync")
        }
    },
    restore = { m ->
        when (m[K_DESTINO]) {
            "registrar" -> Destino.Registrar(m[K_CLAVE] as String)
            "nuevo" -> Destino.NuevoProductor
            "midia" -> Destino.MiDia
            "ultimos" -> Destino.UltimosDias
            "dia" -> Destino.DiaAnterior(m[K_FECHA] as String)
            "sync" -> Destino.Sync
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
            aviso = d.aviso,
            confirmar = d.confirmar,
            onTocarProductor = { destino = Rumbo.alTocarProductor(it) },
            onConfirmarOtraEntrega = { destino = Rumbo.alConfirmarOtraEntrega(destino) },
            onCancelarConfirmacion = { destino = Rumbo.alCancelarConfirmacion(destino) },
            onNuevoProductor = { destino = Destino.NuevoProductor },
            onMiDia = { destino = Destino.MiDia },
            onSincronizar = { destino = Destino.Sync },
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

        Destino.MiDia -> MiDiaPantalla(
            miDia = contenedor.miDia,
            onVolver = { destino = Destino.Inicio() },
            onDiasAnteriores = { destino = Destino.UltimosDias },
        )

        Destino.UltimosDias -> UltimosDiasPantalla(
            miDia = contenedor.miDia,
            onAbrirDia = { fecha, esHoy -> destino = Rumbo.alAbrirDia(esHoy, fecha) },
            onVolver = { destino = Destino.MiDia },
        )

        is Destino.DiaAnterior -> MiDiaPantalla(
            miDia = contenedor.miDia,
            fecha = LocalDate.parse(d.fecha),
            onVolver = { destino = Destino.UltimosDias },
        )

        Destino.Sync -> SyncPantalla(
            dao = dao,
            motor = contenedor.motorSync,
            onVolver = { destino = Destino.Inicio() },
        )
    }

    // Habilitado también mientras está abierto el aviso de "otra entrega": así no hay salto
    // deshabilitado → habilitado al entrar a B4 (ver Rumbo.atras).
    val atras = Rumbo.atras(destino)
    BackHandler(enabled = atras != null) { atras?.let { destino = it } }
}
