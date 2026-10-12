package pe.queseria.campo

import android.app.Application
import pe.queseria.campo.sync.SyncWorker

class QueseriaApp : Application() {
    lateinit var contenedor: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        contenedor = AppContainer(this)
        SyncWorker.programarPeriodico(this)
    }
}
