@file:OptIn(ExperimentalSerializationApi::class)

package pe.queseria.campo.datos.remoto

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonUnquotedLiteral
import kotlinx.serialization.json.jsonPrimitive

// Espejo de backend/app/esquemas/auth.py y sync.py. Contrato: docs/sincronizacion.md

/**
 * Número que viaja en el JSON con el texto EXACTO que se firmó ("23.50", "-15.614512"),
 * sin pasar por Double (que podría cambiar los decimales).
 */
@Serializable(with = NumeroExacto.Serializador::class)
data class NumeroExacto(val texto: String) {
    init {
        require(PATRON.matches(texto)) { "Número inválido: $texto" }
    }

    object Serializador : KSerializer<NumeroExacto> {
        override val descriptor = PrimitiveSerialDescriptor("NumeroExacto", PrimitiveKind.STRING)
        override fun serialize(encoder: Encoder, value: NumeroExacto) {
            if (encoder is JsonEncoder) encoder.encodeJsonElement(JsonUnquotedLiteral(value.texto))
            else encoder.encodeString(value.texto)
        }

        override fun deserialize(decoder: Decoder): NumeroExacto =
            NumeroExacto((decoder as JsonDecoder).decodeJsonElement().jsonPrimitive.content)
    }

    private companion object {
        val PATRON = Regex("^-?[0-9]+(\\.[0-9]+)?$")
    }
}

/** Cuerpo de error de la API: {"codigo": "...", "mensaje": "..."} */
@Serializable
data class ErrorCuerpo(val codigo: String? = null, val mensaje: String? = null)

// ----------------------------------------------------------------- auth
@Serializable
data class ActivarDto(
    val codigo: String,
    @SerialName("device_uuid") val deviceUuid: String,
    @SerialName("clave_publica") val clavePublica: String,
    val modelo: String?,
    /** El PIN que el usuario acaba de crear (4 dígitos). */
    val pin: String,
)

@Serializable
data class LoginPinDto(@SerialName("device_uuid") val deviceUuid: String, val pin: String)

@Serializable
data class UsuarioSesionDto(val id: Long, val rol: String, @SerialName("nombre_completo") val nombreCompleto: String)

@Serializable
data class DispositivoActivadoDto(
    @SerialName("dispositivo_id") val dispositivoId: Long,
    @SerialName("activado_en") val activadoEn: String,
    val usuario: UsuarioSesionDto,
    /** Activar ya abre la sesión: el servidor devuelve el token (no hace falta otro login). */
    @SerialName("access_token") val accessToken: String,
    @SerialName("expira_en_min") val expiraEnMin: Int,
)

@Serializable
data class TokenMovilDto(
    @SerialName("access_token") val accessToken: String,
    @SerialName("expira_en_min") val expiraEnMin: Int,
    @SerialName("dispositivo_id") val dispositivoId: Long,
    val usuario: UsuarioSesionDto,
)

// ----------------------------------------------------------------- push
@Serializable
data class ProductorPushDto(
    @SerialName("uuid_cliente") val uuidCliente: String,
    val nombre: String,
    val documento: String?,
    val celular: String?,
    @SerialName("ruta_id") val rutaId: Long?,
)

@Serializable
data class RecoleccionPushDto(
    val id: String,
    @SerialName("productor_id") val productorId: Long?,
    @SerialName("productor_uuid_cliente") val productorUuidCliente: String?,
    val litros: NumeroExacto,
    val observacion: String?,
    @SerialName("registrada_en") val registradaEn: String,
    val latitud: NumeroExacto?,
    val longitud: NumeroExacto?,
    @SerialName("precision_m") val precisionM: NumeroExacto?,
    @SerialName("origen_ubicacion") val origenUbicacion: String?,
    @SerialName("ubicacion_simulada") val ubicacionSimulada: Boolean,
    @SerialName("hora_gps") val horaGps: String?,
    @SerialName("hora_automatica") val horaAutomatica: Boolean?,
    @SerialName("hash_anterior") val hashAnterior: String?,
    val firma: String?,
)

@Serializable
data class LotePushDto(
    val productores: List<ProductorPushDto> = emptyList(),
    val recolecciones: List<RecoleccionPushDto> = emptyList(),
)

@Serializable
data class ResultadoProductorDto(
    val indice: Int,
    @SerialName("uuid_cliente") val uuidCliente: String? = null,
    val estado: String,
    val motivo: String? = null,
    @SerialName("productor_id") val productorId: Long? = null,
    val codigo: String? = null,
)

@Serializable
data class ResultadoRecoleccionDto(
    val indice: Int,
    val id: String? = null,
    val estado: String,
    val motivo: String? = null,
    val alertas: List<String> = emptyList(),
)

@Serializable
data class RespuestaPushDto(
    val productores: List<ResultadoProductorDto> = emptyList(),
    val recolecciones: List<ResultadoRecoleccionDto> = emptyList(),
    @SerialName("servidor_ahora") val servidorAhora: String? = null,
)

object EstadoItem {
    const val CREADO = "creado"
    const val DUPLICADO = "duplicado"
    const val RECHAZADO = "rechazado"
}

// ----------------------------------------------------------------- pull (acopiador)
@Serializable
data class RutaPullDto(val id: Long, val nombre: String, val descripcion: String? = null,
                       @SerialName("actualizado_en") val actualizadoEn: String)

@Serializable
data class ProductorPullDto(
    val id: Long,
    val codigo: String,
    val nombre: String,
    val documento: String? = null,
    val celular: String? = null,
    val tipo: String,
    @SerialName("ruta_id") val rutaId: Long? = null,
    @SerialName("latitud_ref") val latitudRef: Double? = null,
    @SerialName("longitud_ref") val longitudRef: Double? = null,
    val aprobado: Boolean,
    @SerialName("uuid_cliente") val uuidCliente: String? = null,
    @SerialName("actualizado_en") val actualizadoEn: String,
)

@Serializable
data class EstadoProductorDto(
    @SerialName("productor_id") val productorId: Long,
    val sancionado: Boolean,
    val bloqueado: Boolean,
    @SerialName("sancion_hasta") val sancionHasta: String? = null,
)

@Serializable
data class PreciosDto(val fecha: String, val normal: Double? = null, val sancion: Double? = null)

interface PullSyncDto {
    val rol: String
    val servidorAhora: String
    val siguienteDesde: String
}

@Serializable
data class PullAcopiadorDto(
    override val rol: String,
    @SerialName("servidor_ahora") override val servidorAhora: String,
    @SerialName("siguiente_desde") override val siguienteDesde: String,
    val estados: List<EstadoProductorDto> = emptyList(),
    val rutas: List<RutaPullDto> = emptyList(),
    @SerialName("ruta_ids_vigentes") val rutaIdsVigentes: List<Long> = emptyList(),
    val productores: List<ProductorPullDto> = emptyList(),
    @SerialName("productor_ids_vigentes") val productorIdsVigentes: List<Long> = emptyList(),
    val precios: PreciosDto? = null,
) : PullSyncDto

/** Pull del analista (0.8.0): rutas activas, productores de todas ellas y externos. No trae entregas. */
@Serializable
data class PullAnalistaDto(
    override val rol: String,
    @SerialName("servidor_ahora") override val servidorAhora: String,
    @SerialName("siguiente_desde") override val siguienteDesde: String,
    val estados: List<EstadoProductorDto> = emptyList(),
    val rutas: List<RutaPullDto> = emptyList(),
    @SerialName("ruta_ids_vigentes") val rutaIdsVigentes: List<Long> = emptyList(),
    val productores: List<ProductorPullDto> = emptyList(),
    @SerialName("productor_ids_vigentes") val productorIdsVigentes: List<Long> = emptyList(),
) : PullSyncDto

/** Respuesta de POST /analista/reportes (creado o duplicado). */
@Serializable
data class ReporteGuardadoDto(
    @SerialName("uuid_reporte") val uuidReporte: String,
    val estado: String,
    @SerialName("recoleccion_id") val recoleccionId: String,
    @SerialName("foto_url") val fotoUrl: String,
)

// ----------------------------------------------------------------- mi día
@Serializable
data class RecoleccionMiDiaDto(
    @SerialName("recoleccion_id") val recoleccionId: String,
    @SerialName("registrada_en") val registradaEn: String,
    @SerialName("productor_id") val productorId: Long,
    @SerialName("productor_codigo") val productorCodigo: String,
    val productor: String,
    val litros: Double,
    @SerialName("estado_calidad") val estadoCalidad: String,
    val revisada: Boolean,
    @SerialName("anulada_en") val anuladaEn: String? = null,
)

@Serializable
data class MiDiaDto(
    val fecha: String,
    @SerialName("total_litros") val totalLitros: Double,
    @SerialName("n_recolecciones") val nRecolecciones: Int,
    val recolecciones: List<RecoleccionMiDiaDto> = emptyList(),
)
