package pe.queseria.campo.registro

import pe.queseria.campo.datos.local.RecoleccionEntidad
import pe.queseria.campo.datos.remoto.NumeroExacto
import pe.queseria.campo.datos.remoto.RecoleccionPushDto
import pe.queseria.campo.firma.DatosFirmados
import pe.queseria.campo.firma.Firmador
import pe.queseria.campo.firma.Formato
import java.math.BigDecimal
import java.time.Instant

object OrigenUbicacion {
    const val GPS = "gps"
    const val ULTIMA_CONOCIDA = "ultima_conocida"
    const val NINGUNA = "ninguna"
}

/** Lectura del GPS al registrar. Si no hay lectura, la recolección se guarda igual (origen 'ninguna'). */
data class LecturaUbicacion(
    val latitud: Double,
    val longitud: Double,
    val precisionM: Float?,
    val simulada: Boolean,
    val horaGps: Instant?,
    val origen: String = OrigenUbicacion.GPS,
)

/** Lo que ingresa el acopiador. El productor va por id del servidor o, si aún no lo tiene, por uuid_cliente. */
data class NuevaRecoleccion(
    val productorId: Long?,
    val productorUuidCliente: String?,
    val productorNombre: String,
    val litros: BigDecimal,
    val observacion: String?,
    val ubicacion: LecturaUbicacion?,
    val horaAutomatica: Boolean,
)

/** Arma la recolección firmada (función pura: la clave y la firma anterior se reciben de afuera). */
object ArmadoRecoleccion {

    fun armar(
        n: NuevaRecoleccion,
        id: String,
        ahora: Instant,
        firmaAnterior: String?,
        firmar: (String) -> String,
    ): RecoleccionEntidad {
        require(n.litros.signum() > 0) { "Los litros deben ser mayores que cero" }
        require(n.productorId != null || n.productorUuidCliente != null) { "Falta el productor" }
        val u = n.ubicacion
        val datos = DatosFirmados(
            id = id.lowercase(),
            productorId = n.productorId,
            productorUuidCliente = if (n.productorId == null) n.productorUuidCliente!!.lowercase() else null,
            litros = Formato.litros(n.litros),
            registradaEn = Formato.hora(ahora),
            latitud = u?.let { Formato.coordenada(it.latitud) },
            longitud = u?.let { Formato.coordenada(it.longitud) },
            precisionM = u?.precisionM?.let { Formato.precision(it) },
            origenUbicacion = u?.origen ?: OrigenUbicacion.NINGUNA,
            ubicacionSimulada = u?.simulada ?: false,
            horaGps = u?.horaGps?.let { Formato.hora(it) },
            horaAutomatica = n.horaAutomatica,
            observacion = n.observacion?.takeIf { it.isNotEmpty() },
            hashAnterior = Firmador.hashAnterior(firmaAnterior),
        )
        val firma = firmar(Firmador.cadenaV1(datos))
        return RecoleccionEntidad(
            id = datos.id,
            productorId = datos.productorId,
            productorUuidCliente = datos.productorUuidCliente,
            litros = datos.litros,
            observacion = datos.observacion,
            registradaEn = datos.registradaEn,
            latitud = datos.latitud,
            longitud = datos.longitud,
            precisionM = datos.precisionM,
            origenUbicacion = datos.origenUbicacion!!,
            ubicacionSimulada = datos.ubicacionSimulada,
            horaGps = datos.horaGps,
            horaAutomatica = n.horaAutomatica,
            hashAnterior = datos.hashAnterior,
            firma = firma,
            productorNombre = n.productorNombre,
            registradaEnMs = ahora.toEpochMilli(),
        )
    }

    /** Los mismos datos que se firmaron, leídos de Room (para verificar o reenviar). */
    fun datosFirmados(r: RecoleccionEntidad) = DatosFirmados(
        id = r.id,
        productorId = r.productorId,
        productorUuidCliente = r.productorUuidCliente,
        litros = r.litros,
        registradaEn = r.registradaEn,
        latitud = r.latitud,
        longitud = r.longitud,
        precisionM = r.precisionM,
        origenUbicacion = r.origenUbicacion,
        ubicacionSimulada = r.ubicacionSimulada,
        horaGps = r.horaGps,
        horaAutomatica = r.horaAutomatica,
        observacion = r.observacion,
        hashAnterior = r.hashAnterior,
    )

    /** JSON de /sync/push con exactamente los textos firmados. */
    fun aDto(r: RecoleccionEntidad) = RecoleccionPushDto(
        id = r.id,
        productorId = r.productorId,
        productorUuidCliente = r.productorUuidCliente,
        litros = NumeroExacto(r.litros),
        observacion = r.observacion,
        registradaEn = r.registradaEn,
        latitud = r.latitud?.let(::NumeroExacto),
        longitud = r.longitud?.let(::NumeroExacto),
        precisionM = r.precisionM?.let(::NumeroExacto),
        origenUbicacion = r.origenUbicacion,
        ubicacionSimulada = r.ubicacionSimulada,
        horaGps = r.horaGps,
        horaAutomatica = r.horaAutomatica,
        hashAnterior = r.hashAnterior,
        firma = r.firma,
    )
}
