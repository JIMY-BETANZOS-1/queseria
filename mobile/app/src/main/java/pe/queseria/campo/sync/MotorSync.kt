package pe.queseria.campo.sync

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.asRequestBody
import pe.queseria.campo.datos.local.EstadoProductorEntidad
import pe.queseria.campo.datos.local.AnalistaDao
import pe.queseria.campo.datos.local.EntregaAnalistaEntidad
import pe.queseria.campo.datos.local.RevisionCalidadEntidad
import pe.queseria.campo.datos.local.EstadoSync
import pe.queseria.campo.datos.local.Meta
import pe.queseria.campo.datos.local.MetaEntidad
import pe.queseria.campo.datos.local.ProductorEntidad
import pe.queseria.campo.datos.local.RutaEntidad
import pe.queseria.campo.datos.local.SyncDao
import pe.queseria.campo.datos.remoto.ApiQueseria
import pe.queseria.campo.datos.remoto.ApiAnalistaQueseria
import pe.queseria.campo.datos.remoto.ErrorApp
import pe.queseria.campo.datos.remoto.EstadoItem
import pe.queseria.campo.datos.remoto.LotePushDto
import pe.queseria.campo.datos.remoto.PreciosDto
import pe.queseria.campo.datos.remoto.ProductorPushDto
import pe.queseria.campo.datos.remoto.PullAcopiadorDto
import pe.queseria.campo.datos.remoto.PullAnalistaDto
import pe.queseria.campo.datos.remoto.PullSyncDto
import pe.queseria.campo.datos.remoto.RevisionCalidadDto
import pe.queseria.campo.datos.remoto.NumeroExacto
import pe.queseria.campo.datos.remoto.Red
import pe.queseria.campo.datos.remoto.RespuestaPushDto
import pe.queseria.campo.datos.remoto.llamar
import pe.queseria.campo.registro.ArmadoRecoleccion

/** Lo que el motor necesita del servidor (interfaz para probarlo sin red). Lanza [ErrorApp]. */
interface RemotoSync {
    suspend fun push(lote: LotePushDto): RespuestaPushDto
    suspend fun pull(desde: String?): PullSyncDto
    suspend fun calidad(lote: pe.queseria.campo.datos.remoto.LoteCalidadDto): pe.queseria.campo.datos.remoto.RespuestaCalidadDto =
        throw ErrorApp.Local("Este usuario no puede registrar calidad")
    suspend fun subirFoto(recoleccionId: String, rutaLocal: String): pe.queseria.campo.datos.remoto.FotoGuardadaDto =
        throw ErrorApp.Local("Este usuario no puede subir fotos")
}

class RemotoApi(
    private val api: () -> ApiQueseria,
    private val bearer: () -> String,
    private val rol: () -> String = { "acopiador" },
    private val analistaApi: (() -> ApiAnalistaQueseria)? = null,
) : RemotoSync {
    override suspend fun push(lote: LotePushDto) = llamar { api().push(bearer(), lote) }
    override suspend fun pull(desde: String?): PullSyncDto = llamar {
        if (rol() == "analista") {
            val json = requireNotNull(analistaApi).invoke().pull(bearer(), desde)
            Red.json.decodeFromJsonElement(PullAnalistaDto.serializer(), json)
        } else {
            api().pull(bearer(), desde)
        }
    }
    override suspend fun calidad(lote: pe.queseria.campo.datos.remoto.LoteCalidadDto) =
        llamar { requireNotNull(analistaApi).invoke().calidad(bearer(), lote) }
    override suspend fun subirFoto(recoleccionId: String, rutaLocal: String) = llamar {
        val archivo = java.io.File(rutaLocal)
        if (!archivo.isFile) throw ErrorApp.Local("La foto local ya no está disponible")
        requireNotNull(analistaApi).invoke().subirFoto(
            bearer(), recoleccionId,
            okhttp3.MultipartBody.Part.createFormData(
                "archivo", archivo.name,
                archivo.asRequestBody("image/jpeg".toMediaType()),
            ),
        )
    }
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
    private val analistaDao: AnalistaDao? = null,
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
        if (pull.rol == "analista") {
            val analista = pull as? PullAnalistaDto
                ?: throw ErrorApp.Local("Respuesta inválida del servidor para analista")
            val revisiones = analistaDao?.revisionesPorSincronizar().orEmpty()
            if (revisiones.isNotEmpty()) {
                val respuesta = remoto.calidad(revisiones.map {
                    RevisionCalidadDto(it.recoleccionId, it.estado, it.ph?.numero(), it.temperaturaC?.numero(),
                        it.grasaPct?.numero(), it.densidad?.numero(), it.antibioticosPositivo)
                }.let { pe.queseria.campo.datos.remoto.LoteCalidadDto(it) })
                respuesta.revisiones.filter { it.estado == "creado" || it.estado == "duplicado" }
                    .forEach { resultado ->
                        resultado.recoleccionId?.let { id ->
                            analistaDao?.marcarCalidadSincronizada(id)
                            val revision = revisiones.first { it.recoleccionId == id }
                            if (revision.fotoUri == null) analistaDao?.borrarRevision(id)
                        }
                    }
            }
            val fotos = analistaDao?.revisionesPendientes().orEmpty()
                .filter { it.calidadSincronizada && it.fotoUri != null }
            fotos.forEach { revision ->
                val foto = remoto.subirFoto(revision.recoleccionId, requireNotNull(revision.fotoUri))
                analistaDao?.guardarFotoUrl(revision.recoleccionId, foto.fotoUrl)
                analistaDao?.borrarRevision(revision.recoleccionId)
            }
            analistaDao?.aplicarPull(analista.recoleccionesHoy.map {
                EntregaAnalistaEntidad(it.id, it.productorId, it.productorCodigo, it.productor,
                    it.tipoProductor, it.acopiador, it.litros, it.registradaEn, it.observacion,
                    it.estadoCalidad, it.revisada, it.anulada, it.analisis?.ph,
                    it.analisis?.temperaturaC, it.analisis?.grasaPct, it.analisis?.densidad,
                    it.analisis?.antibioticosPositivo, it.analisis?.fotoUrl,
                    java.time.Instant.parse(it.registradaEn).toEpochMilli())
            })
            dao.guardarMeta(MetaEntidad(Meta.CURSOR_PULL, analista.siguienteDesde))
            return
        }
        val acopiador = pull as? PullAcopiadorDto
            ?: throw ErrorApp.Local("Respuesta inválida del servidor para acopiador")
        val pullAcopiador = acopiador
        dao.aplicarPull(
            rutas = pullAcopiador.rutas.map { RutaEntidad(it.id, it.nombre, it.descripcion, it.actualizadoEn) },
            rutaIdsVigentes = pullAcopiador.rutaIdsVigentes.toSet(),
            productores = pullAcopiador.productores.map {
                ProductorEntidad(
                    clave = ProductorEntidad.claveDe(it.id, it.uuidCliente),
                    servidorId = it.id, uuidCliente = it.uuidCliente?.lowercase(), codigo = it.codigo,
                    nombre = it.nombre, documento = it.documento, celular = it.celular, rutaId = it.rutaId,
                    latitudRef = it.latitudRef, longitudRef = it.longitudRef, aprobado = it.aprobado,
                    actualizadoEn = it.actualizadoEn, estadoSync = EstadoSync.SINCRONIZADO, motivo = null,
                    creadoEnMs = reloj(),
                )
            },
            productorIdsVigentes = pullAcopiador.productorIdsVigentes.toSet(),
            estados = pullAcopiador.estados.map { EstadoProductorEntidad(it.productorId, it.sancionado, it.bloqueado, it.sancionHasta) },
            meta = listOf(
                MetaEntidad(Meta.CURSOR_PULL, pullAcopiador.siguienteDesde),
                MetaEntidad(Meta.PRECIOS, pullAcopiador.precios?.let { Red.json.encodeToString(PreciosDto.serializer(), it) }),
            ),
            purgarAntesDeMs = reloj() - DIAS_CONSERVAR_MS,
        )
    }

    private fun String.numero() = NumeroExacto(this)

    companion object {
        /** Las recolecciones ya confirmadas se conservan unos días para "Mi día" y consultas. */
        const val DIAS_CONSERVAR_MS = 7L * 24 * 60 * 60 * 1000
    }
}
