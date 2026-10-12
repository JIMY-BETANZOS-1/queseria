package pe.queseria.campo.datos.remoto

import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Query
import java.util.concurrent.TimeUnit

/** Endpoints reales del backend que usa el acopiador (backend/app/routers/auth.py, sync.py, acopiador.py). */
interface ApiQueseria {
    @POST("auth/dispositivo/activar")
    suspend fun activar(@Body cuerpo: ActivarDto): DispositivoActivadoDto

    @POST("auth/pin/login")
    suspend fun loginPin(@Body cuerpo: LoginPinDto): TokenMovilDto

    @POST("auth/pin/cambiar")
    suspend fun cambiarPin(@Header("Authorization") bearer: String, @Body cuerpo: CambiarPinDto): Response<Unit>

    @POST("sync/push")
    suspend fun push(@Header("Authorization") bearer: String, @Body lote: LotePushDto): RespuestaPushDto

    @GET("sync/pull")
    suspend fun pull(@Header("Authorization") bearer: String, @Query("desde") desde: String?): PullAcopiadorDto

    @GET("acopiador/mi-dia")
    suspend fun miDia(@Header("Authorization") bearer: String): MiDiaDto
}

object Red {
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
            .build()
        return Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(cliente)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(ApiQueseria::class.java)
    }
}
