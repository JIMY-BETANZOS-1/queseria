package pe.queseria.campo.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import pe.queseria.campo.QueseriaApp
import pe.queseria.campo.datos.remoto.ErrorApp
import java.util.concurrent.TimeUnit

/** Sincroniza en segundo plano cuando hay red. Reintenta con espera exponencial ante fallas de red/servidor. */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val c = (applicationContext as QueseriaApp).contenedor
        if (c.autenticador.usuario() == null) return Result.success()   // celular sin vincular
        return try {
            c.motorSync.sincronizar()
            Result.success()
        } catch (e: ErrorApp) {
            when {
                e.esTransitorio -> Result.retry()
                e is ErrorApp.NoAutorizado -> {
                    // Token vencido o celular desactivado: espera a que el acopiador ingrese con PIN y señal
                    c.autenticador.invalidarToken()
                    Result.failure()
                }
                else -> Result.failure()
            }
        }
    }

    companion object {
        private const val UNICO_AHORA = "sync-ahora"
        private const val UNICO_PERIODICO = "sync-periodico"

        private val conRed = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        /** Disparo manual ("Sincronizar ahora") o tras registrar: corre apenas haya red. */
        fun sincronizarAhora(context: Context) {
            val pedido = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(conRed)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(UNICO_AHORA, ExistingWorkPolicy.REPLACE, pedido)
        }

        /** Respaldo periódico (cada 15 min, el mínimo de Android) mientras haya red. */
        fun programarPeriodico(context: Context) {
            val pedido = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(conRed)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(UNICO_PERIODICO, ExistingPeriodicWorkPolicy.KEEP, pedido)
        }

        fun nombreAhora() = UNICO_AHORA
    }
}
