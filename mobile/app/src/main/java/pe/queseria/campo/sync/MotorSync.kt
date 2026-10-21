package pe.queseria.campo.sync

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import pe.queseria.campo.datos.local.AnalistaDao
import pe.queseria.campo.datos.local.EstadoProductorEntidad
import pe.queseria.campo.datos.local.EstadoSync
import pe.queseria.campo.datos.local.Meta
import pe.queseria.campo.datos.local.MetaEntidad
import pe.queseria.campo.datos.local.ProductorEntidad
import pe.queseria.campo.datos.local.RutaEntidad
import pe.queseria.campo.datos.local.SyncDao
import pe.queseria.campo.datos.remoto.ApiAnalistaQueseria
import pe.queseria.campo.datos.remoto.ApiQueseria
import pe.queseria.campo.datos.remoto.ErrorApp
import pe.queseria.campo.datos.remoto.EstadoItem
import pe.queseria.campo.datos.remoto.EstadoProductorDto
import pe.queseria.campo.datos.remoto.LotePushDto
import pe.queseria.campo.datos.remoto.PreciosDto
import pe.queseria.campo.datos.remoto.ProductorPullDto
import pe.queseria.campo.datos.remoto.ProductorPushDto
import pe.queseria.campo.datos.remoto.PullAcopiadorDto
import pe.queseria.campo.datos.remoto.PullAnalistaDto
import pe.queseria.campo.datos.remoto.PullSyncDto
import pe.queseria.campo.datos.remoto.Red
import pe.queseria.campo.datos.remoto.ReporteGuardadoDto
import pe.queseria.campo.datos.remoto.RespuestaPushDto
import pe.queseria.campo.datos.remoto.RutaPullDto
import pe.queseria.campo.datos.remoto.llamar
import pe.queseria.campo.registro.ArmadoRecoleccion

/** Lo que el motor necesita del servidor (interfaz para probarlo sin red). Lanza [ErrorApp]. */
interface RemotoSync {
    suspend fun push(lote: LotePushDto): RespuestaPushDto
    suspend fun pull(desde: String?): PullSyncDto
    /** Reporte del analista (solo la foto; el comentario no tiene dónde guardarse en el servidor). */
    suspend fun subirReporte(uuidReporte: String, productorId: Long?, productorUuidCliente: String?,
                             rutaFoto: String): ReporteGuardadoDto =
        throw ErrorApp.Local("Este usuario no puede enviar reportes")
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
    override suspend fun subirReporte(uuidReporte: String, productorId: Long?, productorUuidCliente: String?,
                                      rutaFoto: String) = llamar {
        val archivo = java.io.File(rutaFoto)
        if (!archivo.isFile) throw ErrorApp.Local("La foto ya no está en el celular")
        val texto = "text/plain".toMediaType()
        requireNotNull(analistaApi).invoke().subirReporte(
            bearer(), uuidReporte.toRequestBody(texto), productorId?.toString()?.toRequestBody(texto),
            productorUuidCliente?.toRequestBody(texto),
            MultipartBody.Part.createFormData("foto", archivo.name, archivo.asRequestBody("image/jpeg".toMediaType())),
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
    val reportesEnviados: Int = 0,
) {
    val rechazados: Int get() = productoresRechazados + recoleccionesRechazadas
}

/**
 * Sincronización (docs/sincronizacion.md):
 *  1. push por lotes (≤ [tamLote]): primero los productores de campo, luego las recolecciones.
 *     creado/duplicado → SINCRONIZADO; rechazado → RECHAZADO con su motivo (se conserva y no se reenvía);
 *     falla de red o del servidor → siguen PENDIENTES y se cuenta el intento (WorkManager reintenta).
 *     Reenviar es seguro: el servidor es idempotente por id / uuid_cliente.
 *  2. reportes del analista con foto (uno por uno; 409 = el servidor aún no puede asociarlo: sigue en cola).
 *  3. pull incremental con el cursor siguiente_desde (upsert por id; borra lo que ya no está vigente).
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
            val resumen = subir().copy(reportesEnviados = enviarReportes())
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

    /**
     * Reportes del analista con foto, después de las altas (un externo nuevo ya existe en el servidor).
     * 409 (sin entrega libre o productor aún no subido) → sigue PENDIENTE con su motivo; 422/403 o foto perdida →
     * RECHAZADO. Una falla transitoria (red, 5xx) corta la vuelta para que WorkManager reintente.
     */
    private suspend fun enviarReportes(): Int {
        val dao = analistaDao ?: return 0
        var enviados = 0
        for (r in dao.reportesPorEnviar()) {
            val foto = r.fotoRuta ?: continue
            val p = dao.productor(r.productorClave)
            if (p == null) {
                dao.reporteRechazado(r.id, "El productor ya no está en la lista")
                continue
            }
            if (p.estadoSync == EstadoSync.RECHAZADO) {
                dao.reporteRechazado(r.id, "El alta del productor fue rechazada: ${p.motivo ?: "sin motivo"}")
                continue
            }
            try {
                remoto.subirReporte(r.id, p.servidorId, if (p.servidorId == null) p.uuidCliente else null, foto)
                dao.reporteEnviado(r.id, reloj())
                enviados++
            } catch (e: ErrorApp) {
                when (e) {
                    is ErrorApp.Conflicto -> dao.reporteReintentar(r.id, e.message)
                    is ErrorApp.Validacion, is ErrorApp.Prohibido, is ErrorApp.Local -> dao.reporteRechazado(r.id, e.message)
                    else -> {
                        dao.reporteReintentar(r.id, e.message)
                        throw e
                    }
                }
            }
        }
        return enviados
    }

    private suspend fun bajar() {
        when (val pull = remoto.pull(dao.meta(Meta.CURSOR_PULL))) {
            is PullAnalistaDto -> aplicar(pull.rutas, pull.rutaIdsVigentes, pull.productores, pull.productorIdsVigentes,
                                          pull.estados, pull.siguienteDesde, extra = emptyList())
            is PullAcopiadorDto -> aplicar(pull.rutas, pull.rutaIdsVigentes, pull.productores, pull.productorIdsVigentes,
                                           pull.estados, pull.siguienteDesde,
                                           extra = listOf(MetaEntidad(Meta.PRECIOS,
                                               pull.precios?.let { Red.json.encodeToString(PreciosDto.serializer(), it) })))
            else -> throw ErrorApp.Local("Respuesta inválida del servidor")
        }
    }

    /** Acopiador y analista guardan rutas, productores y estados en las mismas tablas. */
    private suspend fun aplicar(
        rutas: List<RutaPullDto>, rutaIdsVigentes: List<Long>, productores: List<ProductorPullDto>,
        productorIdsVigentes: List<Long>, estados: List<EstadoProductorDto>, siguienteDesde: String, extra: List<MetaEntidad>,
    ) {
        dao.aplicarPull(
            rutas = rutas.map { RutaEntidad(it.id, it.nombre, it.descripcion, it.actualizadoEn) },
            rutaIdsVigentes = rutaIdsVigentes.toSet(),
            productores = productores.map {
                ProductorEntidad(
                    clave = ProductorEntidad.claveDe(it.id, it.uuidCliente),
                    servidorId = it.id, uuidCliente = it.uuidCliente?.lowercase(), codigo = it.codigo,
                    nombre = it.nombre, documento = it.documento, celular = it.celular, rutaId = it.rutaId,
                    latitudRef = it.latitudRef, longitudRef = it.longitudRef, aprobado = it.aprobado,
                    actualizadoEn = it.actualizadoEn, estadoSync = EstadoSync.SINCRONIZADO, motivo = null,
                    creadoEnMs = reloj(),
                )
            },
            productorIdsVigentes = productorIdsVigentes.toSet(),
            estados = estados.map { EstadoProductorEntidad(it.productorId, it.sancionado, it.bloqueado, it.sancionHasta) },
            meta = listOf(MetaEntidad(Meta.CURSOR_PULL, siguienteDesde)) + extra,
            purgarAntesDeMs = reloj() - DIAS_CONSERVAR_MS,
        )
    }

    companion object {
        /** Las recolecciones ya confirmadas se conservan unos días para "Mi día" y consultas. */
        const val DIAS_CONSERVAR_MS = 7L * 24 * 60 * 60 * 1000
    }
}
