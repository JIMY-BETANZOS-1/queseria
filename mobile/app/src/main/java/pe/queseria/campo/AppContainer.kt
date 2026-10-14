package pe.queseria.campo

import android.content.Context
import android.os.Build
import pe.queseria.campo.datos.local.BaseLocal
import pe.queseria.campo.datos.remoto.ApiQueseria
import pe.queseria.campo.datos.remoto.ErrorApp
import pe.queseria.campo.datos.remoto.Red
import pe.queseria.campo.firma.ClaveDispositivo
import pe.queseria.campo.firma.Firmador
import pe.queseria.campo.registro.Registrador
import pe.queseria.campo.seguridad.Autenticador
import pe.queseria.campo.seguridad.CajaFuerte
import pe.queseria.campo.seguridad.PinLocal
import pe.queseria.campo.sync.MiDia
import pe.queseria.campo.sync.MotorSync
import pe.queseria.campo.sync.RemotoApi
import pe.queseria.campo.ubicacion.Ubicador

/** Dependencias de la app (sin Hilt). Se crea una vez en [QueseriaApp]. */
class AppContainer(context: Context) {
    val base: BaseLocal = BaseLocal.crear(context)
    private val caja = CajaFuerte(context)
    val claveDispositivo = ClaveDispositivo()
    private val apiOpcional: ApiQueseria? = Red.crearApi(BuildConfig.API_BASE_URL)

    private fun api(): ApiQueseria =
        apiOpcional ?: throw ErrorApp.Local("Falta configurar la URL del servidor (api.base.url en local.properties)")

    val autenticador = Autenticador(
        api = apiOpcional,
        almacen = caja,
        clavePublica = { Firmador.clavePublicaB64(claveDispositivo.obtenerOCrear()) },
        pin = PinLocal(caja),
        modelo = "${Build.MANUFACTURER} ${Build.MODEL}".take(100),
    )

    val registrador = Registrador(base, claveDispositivo)
    val ubicador = Ubicador(context.applicationContext)
    val motorSync = MotorSync(RemotoApi(::api, autenticador::bearer), base.syncDao())
    val miDia = MiDia(::api, autenticador::bearer, base.syncDao())
}
