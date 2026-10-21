package pe.queseria.campo.sync

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

class FotoAnalisis(private val context: Context) {
    fun guardarComprimida(uri: Uri): String {
        val bitmap = context.contentResolver.openInputStream(uri).use { input ->
            requireNotNull(input) { "No se pudo leer la foto seleccionada" }
            requireNotNull(BitmapFactory.decodeStream(input)) { "El archivo seleccionado no es una imagen válida" }
        }
        val escala = minOf(1f, 1280f / maxOf(bitmap.width, bitmap.height).toFloat())
        val reducida = if (escala < 1f) Bitmap.createScaledBitmap(
            bitmap, (bitmap.width * escala).toInt(), (bitmap.height * escala).toInt(), true,
        ) else bitmap
        val carpeta = File(context.filesDir, "analisis").apply { mkdirs() }
        val destino = File(carpeta, "${UUID.randomUUID()}.jpg")
        FileOutputStream(destino).use { salida ->
            check(reducida.compress(Bitmap.CompressFormat.JPEG, 82, salida)) {
                "No se pudo guardar la foto"
            }
        }
        if (reducida !== bitmap) reducida.recycle()
        if (!bitmap.isRecycled) bitmap.recycle()
        return destino.absolutePath
    }
}
