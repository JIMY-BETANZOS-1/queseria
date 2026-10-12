package pe.queseria.campo.registro

import android.content.Context
import android.provider.Settings
import androidx.room.withTransaction
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import pe.queseria.campo.datos.local.BaseLocal
import pe.queseria.campo.datos.local.EstadoSync
import pe.queseria.campo.datos.local.Meta
import pe.queseria.campo.datos.local.MetaEntidad
import pe.queseria.campo.datos.local.ProductorEntidad
import pe.queseria.campo.datos.local.RecoleccionEntidad
import pe.queseria.campo.firma.ClaveDispositivo
import pe.queseria.campo.firma.Firmador
import java.time.Instant
import java.util.UUID

/**
 * Registro offline: firma con la clave del Keystore y encadena hash_anterior con la firma previa de
 * este celular. Guardar y avanzar la cadena ocurren en la misma transacción (y de a uno, con mutex).
 */
class Registrador(
    private val base: BaseLocal,
    private val clave: ClaveDispositivo,
    private val reloj: () -> Instant = Instant::now,
) {
    private val mutex = Mutex()

    suspend fun registrar(n: NuevaRecoleccion): RecoleccionEntidad = mutex.withLock {
        base.withTransaction {
            val dao = base.syncDao()
            val privada = clave.privada()
            val r = ArmadoRecoleccion.armar(n, UUID.randomUUID().toString(), reloj(), dao.meta(Meta.ULTIMA_FIRMA)) {
                Firmador.firmar(privada, it)
            }
            dao.insertarRecoleccion(r)
            dao.guardarMeta(MetaEntidad(Meta.ULTIMA_FIRMA, r.firma))
            r
        }
    }

    /** Alta de productor de ruta en el campo: nace no aprobado; se sube antes que sus recolecciones. */
    suspend fun crearProductorCampo(nombre: String, documento: String?, celular: String?, rutaId: Long): ProductorEntidad {
        val uuid = UUID.randomUUID().toString()
        val p = ProductorEntidad(
            clave = uuid,
            servidorId = null,
            uuidCliente = uuid,
            codigo = null,
            nombre = nombre.trim(),
            documento = documento?.trim()?.takeIf { it.isNotEmpty() },
            celular = celular?.trim()?.takeIf { it.isNotEmpty() },
            rutaId = rutaId,
            latitudRef = null,
            longitudRef = null,
            aprobado = false,
            actualizadoEn = null,
            estadoSync = EstadoSync.PENDIENTE,
            motivo = null,
            creadoEnMs = reloj().toEpochMilli(),
        )
        base.syncDao().insertarProductor(p)
        return p
    }

    companion object {
        /** "Fecha y hora automáticas" del sistema (evidencia firmada: hora_automatica). */
        fun horaAutomatica(context: Context): Boolean =
            Settings.Global.getInt(context.contentResolver, Settings.Global.AUTO_TIME, 0) == 1
    }
}
