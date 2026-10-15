package pe.queseria.campo.ui.productor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import pe.queseria.campo.datos.local.EstadoSync
import pe.queseria.campo.datos.local.ProductorEntidad

/**
 * Alta de productor en el campo (B5). Lo que se valida aquí es lo que la base exige en
 * `ck_productor_documento` / `ck_productor_celular`: un alta que el servidor rechace deja la leche de
 * ese productor con el pago retenido y sin forma de reasignarla (pendiente (H)).
 */
class AltaProductorTest {

    private fun productor(
        nombre: String = "Juana Mamani",
        documento: String? = null,
        codigo: String? = "P-0007",
        servidorId: Long? = 7,
    ) = ProductorEntidad(
        clave = ProductorEntidad.claveDe(servidorId, if (servidorId == null) "uuid-de-campo" else null),
        servidorId = servidorId,
        uuidCliente = if (servidorId == null) "uuid-de-campo" else null,
        codigo = codigo, nombre = nombre, documento = documento, celular = null, rutaId = 3,
        latitudRef = null, longitudRef = null, aprobado = true, actualizadoEn = null,
        estadoSync = EstadoSync.SINCRONIZADO, motivo = null, creadoEnMs = 0,
    )

    // ─── Validación ───────────────────────────────────────────────────────────

    @Test
    fun `nombre y ruta son lo unico obligatorio`() {
        assertNull(AltaProductor.validar("Juana Mamani", null, null, rutaId = 3))
        assertNull("vacíos valen como nulos", AltaProductor.validar("Juana Mamani", "", "", rutaId = 3))
    }

    @Test
    fun `sin nombre no se guarda`() {
        assertEquals("Escriba el nombre del productor", AltaProductor.validar("", null, null, 3))
        assertEquals("Escriba el nombre del productor", AltaProductor.validar("   ", null, null, 3))
    }

    @Test
    fun `sin ruta no se guarda`() {
        assertEquals("Elija la ruta", AltaProductor.validar("Juana Mamani", null, null, rutaId = null))
    }

    @Test
    fun `el documento admite DNI de 8 y RUC de 11`() {
        assertNull(AltaProductor.validar("Juana", "41234567", null, 3))
        assertNull(AltaProductor.validar("Juana", "20481234567", null, 3))
        assertNull("se recortan los espacios", AltaProductor.validar("Juana", " 41234567 ", null, 3))

        val malo = "El DNI debe tener 8 dígitos (o 11 si es RUC)"
        assertEquals(malo, AltaProductor.validar("Juana", "4123456", null, 3))
        assertEquals(malo, AltaProductor.validar("Juana", "412345678", null, 3))
        assertEquals(malo, AltaProductor.validar("Juana", "4123456A", null, 3))
    }

    @Test
    fun `el celular debe tener nueve digitos`() {
        assertNull(AltaProductor.validar("Juana", null, "951234567", 3))

        val malo = "El celular debe tener 9 dígitos"
        assertEquals(malo, AltaProductor.validar("Juana", null, "95123456", 3))
        assertEquals(malo, AltaProductor.validar("Juana", null, "9512345678", 3))
        assertEquals(malo, AltaProductor.validar("Juana", null, "951-234-567", 3))
    }

    @Test
    fun `el nombre se reclama antes que el resto`() {
        // Si falta todo, el acopiador arregla primero lo de arriba de la pantalla
        assertEquals("Escriba el nombre del productor", AltaProductor.validar("", "mal", "mal", null))
    }

    // ─── Duplicados ───────────────────────────────────────────────────────────

    @Test
    fun `el DNI repetido manda sobre el nombre`() {
        val existentes = listOf(
            productor(nombre = "Juana Mamani", documento = "41234567"),
            productor(nombre = "Rosa Condori", documento = "42345678", servidorId = 9, codigo = "P-0009"),
        )

        // Nombre distinto, DNI de Rosa: el duplicado que importa es el del DNI
        val d = AltaProductor.posibleDuplicado("Otra Persona", "42345678", existentes)!!

        assertTrue("el DNI es UNIQUE en la base: crear otro se rechaza", d.porDocumento)
        assertEquals("Rosa Condori", d.productor.nombre)
        assertEquals(
            "Ese DNI ya es de Rosa Condori · P-0009. Si crea otro productor, el servidor lo rechazará.",
            AltaProductor.textoDuplicado(d),
        )
    }

    @Test
    fun `el nombre igual avisa pero sin dar por hecho que es el mismo`() {
        val d = AltaProductor.posibleDuplicado("  JOSÉ   mamani ", null, listOf(productor(nombre = "Jose Mamani")))!!

        assertTrue("sin DNI solo hay sospecha por el nombre", !d.porDocumento)
        assertEquals(
            "Ya hay un productor con ese nombre: Jose Mamani · P-0007. ¿Es el mismo?",
            AltaProductor.textoDuplicado(d),
        )
    }

    @Test
    fun `un productor nuevo de verdad no avisa nada`() {
        val existentes = listOf(productor(nombre = "Juana Mamani", documento = "41234567"))
        assertNull(AltaProductor.posibleDuplicado("Pedro Quispe", "42345678", existentes))
        assertNull(AltaProductor.posibleDuplicado("Pedro Quispe", null, existentes))
        assertNull("sin nada escrito no se avisa", AltaProductor.posibleDuplicado("  ", null, existentes))
    }

    @Test
    fun `tambien avisa de un alta de campo que todavia no se subio`() {
        // Sin servidor_id ni codigo: el acopiador lo creó hace un rato y aún está PENDIENTE
        val pendiente = productor(nombre = "Juana Mamani", servidorId = null, codigo = null)
        val d = AltaProductor.posibleDuplicado("Juana Mamani", null, listOf(pendiente))!!

        assertEquals(
            "Ya hay un productor con ese nombre: Juana Mamani. ¿Es el mismo?",
            AltaProductor.textoDuplicado(d),
        )
    }
}
