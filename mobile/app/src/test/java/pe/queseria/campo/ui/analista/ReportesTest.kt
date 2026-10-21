package pe.queseria.campo.ui.analista

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import pe.queseria.campo.datos.local.EstadoReporte
import java.time.Instant
import java.time.ZoneId

class ReportesTest {

    @Test
    fun `se guarda con comentario, con foto o con ambos, vacio no`() {
        assertEquals("Escriba un comentario o tome una foto", Reportes.validar("   ", null))
        assertNull(Reportes.validar("Tarro sucio", null))
        assertNull(Reportes.validar("", "/f.jpg"))
        assertNull(Reportes.validar("Tarro sucio", "/f.jpg"))
        assertEquals("El comentario puede tener hasta 500 letras", Reportes.validar("a".repeat(501), null))
    }

    @Test
    fun `con foto queda por enviar y solo comentario se queda en el celular`() {
        val conFoto = Reportes.nuevo("id:7", "Cirilo", "  ", "/f.jpg", 10, id = "r1")
        assertEquals(EstadoReporte.PENDIENTE, conFoto.estado)
        assertNull(conFoto.comentario)
        assertEquals(0, conFoto.intentos)
        val soloTexto = Reportes.nuevo("id:7", "Cirilo", " Volver el lunes ", null, 10)
        assertEquals(EstadoReporte.SOLO_CELULAR, soloTexto.estado)
        assertEquals("Volver el lunes", soloTexto.comentario)
        assertTrue(Reportes.textoEstado(soloTexto).startsWith("Solo en este celular"))
        assertEquals("Foto por enviar · Sin entrega aún",
                     Reportes.textoEstado(conFoto.copy(motivo = "Sin entrega aún")))
        assertEquals("No se pudo enviar: foto inválida",
                     Reportes.textoEstado(conFoto.copy(estado = EstadoReporte.RECHAZADO, motivo = "foto inválida")))
        assertEquals("Foto enviada", Reportes.textoEstado(conFoto.copy(estado = EstadoReporte.ENVIADO)))
    }

    @Test
    fun `fecha y hora en Lima`() {
        val ms = Instant.parse("2026-10-21T14:05:00Z").toEpochMilli()
        assertEquals("21/10 09:05", Reportes.fechaHora(ms, ZoneId.of("America/Lima")))
    }

    @Test
    fun `alta de externo exige nombre, DNI o RUC y celular validos`() {
        assertEquals("Escriba el nombre o la empresa", Reportes.validarExterno(" ", "40111217", "955200003"))
        assertEquals("Escriba el DNI (o el RUC si es empresa)", Reportes.validarExterno("Marcelino", "", "955200003"))
        assertEquals("Escriba el celular", Reportes.validarExterno("Marcelino", "40111217", ""))
        assertEquals("El DNI debe tener 8 dígitos (o 11 si es RUC)", Reportes.validarExterno("Marcelino", "4011121", "955200003"))
        assertEquals("El celular debe tener 9 dígitos", Reportes.validarExterno("Marcelino", "40111217", "95520000"))
        assertNull(Reportes.validarExterno("Marcelino Yupanqui", "40111217", "955200003"))
        assertNull(Reportes.validarExterno("Lácteos del Altiplano S.A.C.", "20601234568", "955200004"))
    }

    @Test
    fun `busqueda por nombre sin tildes, codigo o DNI`() {
        assertTrue(Reportes.coincide("valentin", "Valentín Huarachi Cutipa", "P-0009", "40111209"))
        assertTrue(Reportes.coincide("p-0009", "Valentín", "P-0009", null))
        assertTrue(Reportes.coincide("401112", "Valentín", null, "40111209"))
        assertTrue(Reportes.coincide("", "Cualquiera", null, null))
        assertFalse(Reportes.coincide("gregoria", "Valentín", "P-0009", "40111209"))
    }
}
