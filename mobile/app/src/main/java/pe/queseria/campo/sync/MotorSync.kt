package pe.queseria.campo.sync

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import pe.queseria.campo.datos.local.EstadoProductorEntidad
import pe.queseria.campo.datos.local.EstadoSync
import pe.queseria.campo.datos.local.Meta
import pe.queseria.campo.datos.local.MetaEntidad
import pe.queseria.campo.datos.local.ProductorEntidad
import pe.queseria.campo.datos.local.RutaEntidad
import pe.queseria.campo.datos.local.SyncDao
import pe.queseria.campo.datos.remoto.ApiQueseria
import pe.queseria.campo.datos.remoto.ErrorApp
import pe.queseria.campo.datos.remoto.EstadoItem
import pe.queseria.campo.datos.remoto.LotePushDto
import pe.queseria.campo.datos.remoto.PreciosDto
import pe.queseria.campo.datos.remoto.ProductorPushDto
import pe.queseria.campo.datos.remoto.PullAcopiadorDto
import pe.queseria.campo.datos.remoto.Red
import pe.queseria.campo.datos.remoto.RespuestaPushDto
import pe.queseria.campo.datos.remoto.llamar
import pe.queseria.campo.registro.ArmadoRecoleccion

/** Lo que el motor necesita del servidor (interfaz para probarlo sin red). Lanza [ErrorApp]. */
interface RemotoSync {
    suspend fun push(lote: LotePushDto): RespuestaPushDto
    suspend fun pull(desde: String?): PullAcopiadorDto
}

class RemotoApi(private val api: () -> ApiQueseria, private val bearer: () -> String) : RemotoSync {
    override suspend fun push(lote: LotePushDto) = llamar { api().push(bearer(), lote) }
    override suspend fun pull(desde: String?) = llamar { api().pull(bearer(), desde) }
}

data class ResumenSync(
    /** Solo las altas que el servidor aceptó (creado o duplicado); las rechazadas van aparte. */
    val productoresEnviados: Int = 0,
    val recoleccionesConfirmadas: Int = 0,
    val productoresRechazados: Int = 0,
    val recoleccionesRechazadas: Int = 0,
    val conAlertas: Int = 0,
    val lotes: Int = 0,
) {
    val rechazados: Int get() = productoresRechazados + recoleccionesRechazadas
}

/**
 * Sincronización (docs/sincronizacion.md):
 *  1. push por lotes (≤ [tamLote]): primero los productores de campo, luego las recolecciones.
 *     creado/duplicado → SINCRONIZADO; rechazado → RECHAZADO con su motivo (se conserva y no se reenvía);
 *     falla de red o del servidor → siguen PENDIENTES y se cuenta el intento (WorkManager reintenta).
 *     Reenviar es seguro: el servidor es idempotente por id / uuid_cliente.
 *  2. pull incremental con el cursor siguiente_desde (upsert por id; borra lo que ya no está vigente).
 * Nada local se borra sin confirmación del servidor.
 */
class MotorSync(
    private val remoto: RemotoSync,
    private val dao: SyncDao,
    private val reloj: () -> Long = System::currentTimeMillis,
    private val tamLote: Int = 500,
) {
    private val mutex = Mutex()

    suspend fun sincronizar(): ResumenSync = mutex.withLock {
        try {
            val resumen = subir()
            bajar()
            dao.guardarMeta(MetaEntidad(Meta.ULTIMO_SYNC_MS, reloj().toString()))
            dao.guardarMeta(MetaEntidad(Meta.ULTIMO_ERROR_SYNC, null))
            resumen
        } catch (e: ErrorApp) {
            dao.guardarMeta(MetaEntidad(Meta.ULTIMO_ERROR_SYNC, e.message))
            throw e
        }
    }

    private suspend fun subir(): ResumenSync {
        var r = ResumenSync()
        while (true) {
            val productores = dao.productoresPendientes(tamLote)
            val recolecciones = dao.recoleccionesPendientes(tamLote)
            if (productores.isEmpty() && recolecciones.isEmpty()) return r

            val lote = LotePushDto(
                productores = productores.map { ProductorPushDto(it.uuidCliente!!, it.nombre, it.documento, it.celular, it.rutaId) },
                recolecciones = recolecciones.map(ArmadoRecoleccion::aDto),
            )
            val respuesta = try {
                remoto.push(lote)
            } catch (e: ErrorApp) {
                if (recolecciones.isNotEmpty()) dao.sumarIntento(recolecciones.map { it.id }, e.message)
                throw e
            }

            var avance = 0
            val ahora = reloj()
            for (res in respuesta.productores) {
                val p = productores.getOrNull(res.indice) ?: continue
                r = when (res.estado) {
                    EstadoItem.CREADO, EstadoItem.DUPLICADO -> {
                        dao.productorSincronizado(p.clave, res.productorId, res.codigo)
                        r.copy(productoresEnviados = r.productoresEnviados + 1)
                    }
                    EstadoItem.RECHAZADO -> {
                        dao.productorRechazado(p.clave, res.motivo)
                        r.copy(productoresRechazados = r.productoresRechazados + 1)
                    }
                    else -> continue
                }
                avance++
            }
            for (res in respuesta.recolecciones) {
                val rec = recolecciones.getOrNull(res.indice) ?: continue
                if (res.id != null && res.id.lowercase() != rec.id) continue   // la respuesta no corresponde
                when (res.estado) {
                    EstadoItem.CREADO, EstadoItem.DUPLICADO -> {
                        dao.recoleccionSincronizada(rec.id, res.alertas.takeIf { it.isNotEmpty() }?.joinToString(","), ahora)
                        r = r.copy(recoleccionesConfirmadas = r.recoleccionesConfirmadas + 1,
                                   conAlertas = r.conAlertas + if (res.alertas.isNotEmpty()) 1 else 0)
                    }
                    EstadoItem.RECHAZADO -> {
                        dao.recoleccionRechazada(rec.id, res.motivo)
                        r = r.copy(recoleccionesRechazadas = r.recoleccionesRechazadas + 1)
                    }
                    else -> continue
                }
                avance++
            }
            r = r.copy(lotes = r.lotes + 1)
            // Defensa: si el servidor no resolvió ningún ítem, no insistir en un bucle
            if (avance == 0) throw ErrorApp.Servidor(null, "El servidor no confirmó ningún registro. Se reintentará")
        }
    }

    private suspend fun bajar() {
        val pull = remoto.pull(dao.meta(Meta.CURSOR_PULL))
        if (pull.rol != "acopiador") throw ErrorApp.Local("Esta versión de la app es solo para acopiadores")
        dao.aplicarPull(
            rutas = pull.rutas.map { RutaEntidad(it.id, it.nombre, it.descripcion, it.actualizadoEn) },
            rutaIdsVigentes = pull.rutaIdsVigentes.toSet(),
            productores = pull.productores.map {
                ProductorEntidad(
                    clave = ProductorEntidad.claveDe(it.id, it.uuidCliente),
                    servidorId = it.id, uuidCliente = it.uuidCliente?.lowercase(), codigo = it.codigo,
                    nombre = it.nombre, documento = it.documento, celular = it.celular, rutaId = it.rutaId,
                    latitudRef = it.latitudRef, longitudRef = it.longitudRef, aprobado = it.aprobado,
                    actualizadoEn = it.actualizadoEn, estadoSync = EstadoSync.SINCRONIZADO, motivo = null,
                    creadoEnMs = reloj(),
                )
            },
            productorIdsVigentes = pull.productorIdsVigentes.toSet(),
            estados = pull.estados.map { EstadoProductorEntidad(it.productorId, it.sancionado, it.bloqueado, it.sancionHasta) },
            meta = listOf(
                MetaEntidad(Meta.CURSOR_PULL, pull.siguienteDesde),
                MetaEntidad(Meta.PRECIOS, pull.precios?.let { Red.json.encodeToString(PreciosDto.serializer(), it) }),
            ),
            purgarAntesDeMs = reloj() - DIAS_CONSERVAR_MS,
        )
    }

    companion object {
        /** Las recolecciones ya confirmadas se conservan unos días para "Mi día" y consultas. */
        const val DIAS_CONSERVAR_MS = 7L * 24 * 60 * 60 * 1000
    }
}
