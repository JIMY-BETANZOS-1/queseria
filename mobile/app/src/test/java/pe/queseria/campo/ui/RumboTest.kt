package pe.queseria.campo.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import pe.queseria.campo.datos.local.EstadoSync
import pe.queseria.campo.datos.local.ProductorFila

/** Paso de B3 a B4, incluido el aviso de "otra entrega" que antes dejaba la navegación a medias. */
class RumboTest {

    private val AVISO = "✓ Registrado: 23.50 L · Juana Mamani"

    private fun fila(clave: String = "id:7", nHoy: Int = 0, litrosHoy: Double = 0.0) = ProductorFila(
        clave = clave, servidorId = 7, uuidCliente = null, codigo = "P-0007", nombre = "Juana Mamani",
        rutaId = 3, rutaNombre = "Huata Norte", aprobado = true, estadoSync = EstadoSync.SINCRONIZADO,
        sancionado = false, bloqueado = false, sancionHasta = null, nHoy = nHoy, litrosHoy = litrosHoy,
    )

    @Test
    fun `la primera entrega del dia abre B4 directo`() {
        assertEquals(Destino.Registrar("id:7"), Rumbo.alTocarProductor(fila()))
    }

    @Test
    fun `productor con entregas hoy pide confirmar y al confirmar abre B4`() {
        val destino = Rumbo.alTocarProductor(fila(nHoy = 2, litrosHoy = 23.5))
        assertEquals("primero el aviso, sin salir de B3", Destino.Inicio(confirmar = "id:7"), destino)

        // El caso del fallo: "Sí, otra entrega" tiene que acabar en B4 con ese productor
        assertEquals(Destino.Registrar("id:7"), Rumbo.alConfirmarOtraEntrega(destino))
    }

    @Test
    fun `cancelar el aviso deja B3 sin el aviso`() {
        val destino = Rumbo.alTocarProductor(fila(nHoy = 1, litrosHoy = 8.0))
        assertEquals(Destino.Inicio(), Rumbo.alCancelarConfirmacion(destino))
    }

    @Test
    fun `atras cierra el aviso, luego vuelve de B4 a B3 y despues no hace nada`() {
        val conAviso = Destino.Inicio(confirmar = "id:7")
        assertEquals(Destino.Inicio(), Rumbo.atras(conAviso))
        assertEquals(Destino.Inicio(), Rumbo.atras(Destino.Registrar("id:7")))
        assertNull("en B3 limpio sale de la app", Rumbo.atras(Destino.Inicio()))
        assertNull(Rumbo.atras(Destino.Inicio(aviso = "✓ Registrado: 23.50 L · Juana Mamani")))
    }

    @Test
    fun `mientras el aviso esta abierto el gesto atras ya esta atendido`() {
        // Por esto no hay salto deshabilitado → habilitado al entrar a B4: el BackHandler ya estaba
        // activo con el aviso abierto y un atrás pendiente no se cuela como "volver a B3".
        val conAviso = Destino.Inicio(confirmar = "id:7")
        val enB4 = Rumbo.alConfirmarOtraEntrega(conAviso)
        assert(Rumbo.atras(conAviso) != null)
        assert(Rumbo.atras(enB4) != null)
    }

    @Test
    fun `confirmar o cancelar sin aviso abierto no mueve nada`() {
        val inicio = Destino.Inicio(aviso = "✓ Registrado: 8.00 L · Juana Mamani")
        assertEquals(inicio, Rumbo.alConfirmarOtraEntrega(inicio))
        assertEquals(inicio, Rumbo.alCancelarConfirmacion(inicio))
        val b4 = Destino.Registrar("id:7")
        assertEquals(b4, Rumbo.alConfirmarOtraEntrega(b4))
        assertEquals(b4, Rumbo.alCancelarConfirmacion(b4))
    }

    /**
     * El caso del fallo: registrar y volver a tocar al MISMO productor en seguida.
     * Antes, el ViewModel de B4 seguía en `Guardado` y al reabrir la pantalla el aviso se disparaba
     * otra vez, devolviendo a B3 cuando B4 ya estaba entrando.
     */
    @Test
    fun `guardar y registrar otra entrega del mismo productor en seguida`() {
        var destino: Destino = Destino.Inicio()

        // 1.ª entrega: la fila está en "Pendiente", así que abre B4 directo
        destino = Rumbo.alTocarProductor(fila())
        assertEquals(Destino.Registrar("id:7"), destino)

        // Se guarda: vuelve a B3 con la confirmación
        destino = Rumbo.alGuardar(destino, "id:7", AVISO)
        assertEquals(Destino.Inicio(aviso = AVISO), destino)

        // Se toca el mismo productor, que ya tiene 1 entrega: aviso y confirmación
        destino = Rumbo.alTocarProductor(fila(nHoy = 1, litrosHoy = 23.5))
        assertEquals(Destino.Inicio(confirmar = "id:7"), destino)
        destino = Rumbo.alConfirmarOtraEntrega(destino)
        assertEquals("tiene que quedarse en B4", Destino.Registrar("id:7"), destino)

        // Nada que llegue tarde puede sacarlo de B4
        assertEquals("limpiar el aviso", destino, Rumbo.alLimpiarAviso(destino))
        assertEquals("aviso de otro productor", destino, Rumbo.alGuardar(destino, "id:9", AVISO))
        assertEquals("cancelar una confirmación que ya no está", destino, Rumbo.alCancelarConfirmacion(destino))
        assertEquals("confirmar de nuevo", destino, Rumbo.alConfirmarOtraEntrega(destino))

        // Lo que Rumbo NO puede distinguir: un aviso repetido del MISMO productor es idéntico al
        // guardado legítimo de esta segunda entrega, así que aquí sí vuelve a B3. Por eso el arreglo
        // de verdad está en RegistrarViewModel.guardadoAvisado(), que consume el evento y hace que
        // ese aviso repetido no llegue a existir.
        assertEquals(Destino.Inicio(aviso = AVISO), Rumbo.alGuardar(destino, "id:7", AVISO))
    }

    @Test
    fun `un aviso de guardado que llega tarde no mueve nada`() {
        // Ya se volvió a B3 (o se canceló): el aviso de B4 no debe reescribir el destino
        val enB3 = Destino.Inicio(confirmar = "id:7")
        assertEquals(enB3, Rumbo.alGuardar(enB3, "id:7", AVISO))
        val limpio = Destino.Inicio()
        assertEquals(limpio, Rumbo.alGuardar(limpio, "id:7", AVISO))

        // Y el B4 de otro productor tampoco se interrumpe
        val otroB4 = Destino.Registrar("id:9")
        assertEquals(otroB4, Rumbo.alGuardar(otroB4, "id:7", AVISO))
    }

    @Test
    fun `la limpieza del aviso solo actua en B3`() {
        assertEquals(Destino.Inicio(), Rumbo.alLimpiarAviso(Destino.Inicio(aviso = AVISO)))
        assertEquals(
            "se respeta la confirmación abierta",
            Destino.Inicio(confirmar = "id:7"),
            Rumbo.alLimpiarAviso(Destino.Inicio(aviso = AVISO, confirmar = "id:7")),
        )
        val enB4 = Destino.Registrar("id:7")
        assertEquals(enB4, Rumbo.alLimpiarAviso(enB4))
    }

    @Test
    fun `el aviso de confirmacion no se arrastra a B4`() {
        val destino = Rumbo.alConfirmarOtraEntrega(Destino.Inicio(confirmar = "uuid-de-campo"))
        assertEquals(Destino.Registrar("uuid-de-campo"), destino)
    }

    // ─── B5: alta de productor en el campo ───────────────────────────────────

    @Test
    fun `tras crear el productor se abre B4 con el, y atras vuelve a B3`() {
        // La clave de un alta de campo es su uuid_cliente: todavía no tiene id del servidor
        assertEquals(Destino.Registrar("uuid-de-campo"), Rumbo.alCrearProductor("uuid-de-campo"))
        assertEquals(Destino.Inicio(), Rumbo.atras(Destino.NuevoProductor))
    }

    @Test
    fun `ningun aviso que llegue tarde saca de B5, B6 ni B7`() {
        for (destino in listOf(Destino.NuevoProductor, Destino.MiDia, Destino.Sync)) {
            assertEquals(destino, Rumbo.alGuardar(destino, "id:7", AVISO))
            assertEquals(destino, Rumbo.alLimpiarAviso(destino))
            assertEquals(destino, Rumbo.alConfirmarOtraEntrega(destino))
            assertEquals(destino, Rumbo.alCancelarConfirmacion(destino))
        }
    }

    @Test
    fun `desde B6 y B7 el atras vuelve a B3`() {
        assertEquals(Destino.Inicio(), Rumbo.atras(Destino.MiDia))
        assertEquals(Destino.Inicio(), Rumbo.atras(Destino.Sync))
    }
}
