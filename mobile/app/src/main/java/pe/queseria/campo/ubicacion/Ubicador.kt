package pe.queseria.campo.ubicacion

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.os.Build
import android.os.Looper
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import pe.queseria.campo.registro.LecturaUbicacion
import pe.queseria.campo.registro.OrigenUbicacion
import java.time.Instant
import kotlin.coroutines.resume

/**
 * Lectura del GPS para registrar recolecciones.
 *
 * Regla de oro: **la ubicación nunca bloquea el registro**. Sin permiso, sin señal o con el GPS
 * apagado, todo devuelve null y la recolección se guarda con `origen_ubicacion='ninguna'`.
 * Ningún método lanza: los problemas se traducen en "no hay lectura".
 */
class Ubicador(private val context: Context) {

    private val cliente by lazy { LocationServices.getFusedLocationProviderClient(context) }

    fun conPermiso(): Boolean = PERMISOS.any {
        ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
    }

    /**
     * Lecturas mientras la pantalla esté abierta (`origen='gps'`). Se cancela solo al cerrarse el
     * flujo, así el GPS no queda encendido en segundo plano.
     */
    @SuppressLint("MissingPermission")
    fun flujo(): Flow<LecturaUbicacion> {
        if (!conPermiso()) return emptyFlow()
        return callbackFlow {
            val pedido = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, INTERVALO_MS)
                .setMinUpdateIntervalMillis(INTERVALO_MS)
                .build()
            val callback = object : LocationCallback() {
                override fun onLocationResult(resultado: LocationResult) {
                    resultado.lastLocation?.let { trySend(aLectura(it, OrigenUbicacion.GPS)) }
                }
            }
            val registrado = try {
                cliente.requestLocationUpdates(pedido, callback, Looper.getMainLooper())
                true
            } catch (e: SecurityException) {
                false   // permiso revocado entre la comprobación y el pedido
            }
            if (!registrado) close()
            awaitClose { if (registrado) cliente.removeLocationUpdates(callback) }
        }
    }

    /** Última ubicación que el sistema recuerda (`origen='ultima_conocida'`): no confiable, pero sirve. */
    @SuppressLint("MissingPermission")
    suspend fun ultimaConocida(): LecturaUbicacion? {
        if (!conPermiso()) return null
        return suspendCancellableCoroutine { cont ->
            try {
                cliente.lastLocation
                    .addOnSuccessListener { l ->
                        if (cont.isActive) cont.resume(l?.let { aLectura(it, OrigenUbicacion.ULTIMA_CONOCIDA) })
                    }
                    .addOnFailureListener { if (cont.isActive) cont.resume(null) }
            } catch (e: SecurityException) {
                if (cont.isActive) cont.resume(null)
            }
        }
    }

    private fun aLectura(l: Location, origen: String) = LecturaUbicacion(
        latitud = l.latitude,
        longitud = l.longitude,
        precisionM = if (l.hasAccuracy()) l.accuracy else null,
        simulada = esSimulada(l),
        horaGps = if (l.time > 0) Instant.ofEpochMilli(l.time) else null,
        origen = origen,
    )

    /** Evidencia antifraude: el sistema avisa si la ubicación la puso una app falsa. */
    private fun esSimulada(l: Location): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) l.isMock
        else @Suppress("DEPRECATION") l.isFromMockProvider

    companion object {
        val PERMISOS = arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        private const val INTERVALO_MS = 2_000L
    }
}
