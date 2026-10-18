package pe.queseria.campo.ui.pin

import pe.queseria.campo.seguridad.ReglasPin

/**
 * Teclado del PIN sin botón OK (lógica pura, para probarla sin Compose): se envía solo al teclear el
 * 4.º dígito.
 *
 * Una entrada incompleta nunca se envía, así que nunca llega al servidor ni a [pe.queseria.campo.seguridad.PinLocal]
 * y no puede contar como intento fallido. [enviar] es true **solo** en el paso de 3 a 4 dígitos: un
 * segundo toque antes de que la pantalla se deshabilite no agrega nada ni envía otra vez.
 */
object EntradaPin {

    data class Paso(val pin: String, val enviar: Boolean)

    fun teclear(pin: String, digito: Char): Paso {
        if (pin.length >= ReglasPin.LARGO || digito !in '0'..'9') return Paso(pin, enviar = false)
        val nuevo = pin + digito
        return Paso(nuevo, enviar = nuevo.length == ReglasPin.LARGO)
    }

    fun borrar(pin: String): String = pin.dropLast(1)
}
