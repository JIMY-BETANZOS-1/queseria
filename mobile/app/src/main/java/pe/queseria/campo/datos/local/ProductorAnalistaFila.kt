package pe.queseria.campo.datos.local

import androidx.room.ColumnInfo

/**
 * Productor como lo ve el analista: de cualquier ruta o externo (ruta_id NULL), con su estado de sanción del
 * pull y cuántos reportes suyos tiene este celular. No es una entidad: es el resultado de
 * [AnalistaDao.observarProductores].
 */
data class ProductorAnalistaFila(
    val clave: String,
    @ColumnInfo(name = "servidor_id") val servidorId: Long?,
    val codigo: String?,
    val nombre: String,
    val documento: String?,
    @ColumnInfo(name = "ruta_nombre") val rutaNombre: String?,
    val aprobado: Boolean,
    @ColumnInfo(name = "estado_sync") val estadoSync: String,
    val motivo: String?,
    val sancionado: Boolean,
    val bloqueado: Boolean,
    @ColumnInfo(name = "n_reportes") val nReportes: Int,
    @ColumnInfo(name = "n_por_enviar") val nPorEnviar: Int,
) {
    val esExterno: Boolean get() = rutaNombre == null
}
