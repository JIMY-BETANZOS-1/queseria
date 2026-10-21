package pe.queseria.campo.datos.remoto

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.Multipart
import retrofit2.http.Part
import retrofit2.http.POST
import retrofit2.http.Query
import okhttp3.MultipartBody
import okhttp3.RequestBody
import java.util.concurrent.TimeUnit

/** Endpoints reales del backend que usa el acopiador (backend/app/routers/auth.py, sync.py, acopiador.py). */
interface ApiQueseria {
    @POST("auth/dispositivo/activar")
    suspend fun activar(@Body cuerpo: ActivarDto): DispositivoActivadoDto

    @POST("auth/pin/login")
    suspend fun loginPin(@Body cuerpo: LoginPinDto): TokenMovilDto

    @POST("sync/push")
    suspend fun push(@Header("Authorization") bearer: String, @Body lote: LotePushDto): RespuestaPushDto

    @GET("sync/pull")
    suspend fun pull(@Header("Authorization") bearer: String, @Query("desde") desde: String?): PullAcopiadorDto

    @GET("acopiador/mi-dia")
    suspend fun miDia(@Header("Authorization") bearer: String): MiDiaDto

    /** Hoy y los 6 días anteriores, hoy primero, incluidos los días sin entregas. */
    @GET("acopiador/ultimos-dias")
    suspend fun ultimosDias(@Header("Authorization") bearer: String): List<MiDiaDto>
}

/** Endpoints del analista (backend/app/routers/sync.py y reportes_analista.py). */
interface ApiAnalistaQueseria {
    @GET("sync/pull")
    suspend fun pull(@Header("Authorization") bearer: String, @Query("desde") desde: String?): JsonObject

    @Multipart
    @POST("analista/reportes")
    suspend fun subirReporte(
        @Header("Authorization") bearer: String,
        @Part("uuid_reporte") uuidReporte: RequestBody,
        @Part("productor_id") productorId: RequestBody?,
        @Part("productor_uuid_cliente") productorUuidCliente: RequestBody?,
        @Part foto: MultipartBody.Part,
    ): ReporteGuardadoDto
}

object Red {
    /** El acopiador espera de pie frente al productor: el login con PIN cae pronto al PIN local. */
    const val TIMEOUT_LOGIN_PIN_S = 4L
    private const val RUTA_LOGIN_PIN = "auth/pin/login"

    val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = true
    }

    /** null si falta api.base.url en local.properties. */
    fun crearApi(baseUrl: String): ApiQueseria? {
        if (baseUrl.isBlank()) return null
        val cliente = OkHttpClient.Builder()
            // En el campo la señal es débil: fallar pronto y reintentar con WorkManager
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .addInterceptor(::acortarTimeoutLoginPin)
            .build()
        return Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(cliente)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(ApiQueseria::class.java)
    }

    fun crearApiAnalista(baseUrl: String): ApiAnalistaQueseria? {
        if (baseUrl.isBlank()) return null
        val cliente = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build()
        return Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(cliente)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(ApiAnalistaQueseria::class.java)
    }

    /**
     * Recorta la espera de [RUTA_LOGIN_PIN] a [TIMEOUT_LOGIN_PIN_S]: si el servidor no contesta,
     * el [pe.queseria.campo.seguridad.Autenticador] valida el PIN con el verificador local.
     * Solo vale como interceptor de aplicación (OkHttp no deja ajustar timeouts en los de red).
     */
    private fun acortarTimeoutLoginPin(cadena: Interceptor.Chain): okhttp3.Response {
        val peticion = cadena.request()
        if (!peticion.url.encodedPath.endsWith(RUTA_LOGIN_PIN)) return cadena.proceed(peticion)
        val s = TIMEOUT_LOGIN_PIN_S.toInt()
        return cadena
            .withConnectTimeout(s, TimeUnit.SECONDS)
            .withReadTimeout(s, TimeUnit.SECONDS)
            .withWriteTimeout(s, TimeUnit.SECONDS)
            .proceed(peticion)
    }
}
