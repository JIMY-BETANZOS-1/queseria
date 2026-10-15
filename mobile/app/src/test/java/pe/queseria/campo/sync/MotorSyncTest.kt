package pe.queseria.campo.sync

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import pe.queseria.campo.datos.local.EstadoProductorEntidad
import pe.queseria.campo.datos.local.EstadoSync
import pe.queseria.campo.datos.local.Meta
import pe.queseria.campo.datos.local.MetaEntidad
import pe.queseria.campo.datos.local.ProductorEntidad
import pe.queseria.campo.datos.local.ProductorFila
import pe.queseria.campo.datos.local.RecoleccionEntidad
import pe.queseria.campo.datos.local.RutaEntidad
import pe.queseria.campo.datos.local.SyncDao
import pe.queseria.campo.datos.remoto.ErrorApp
import pe.queseria.campo.datos.remoto.LotePushDto
import pe.queseria.campo.datos.remoto.ProductorPullDto
import pe.queseria.campo.datos.remoto.PullAcopiadorDto
import pe.queseria.campo.datos.remoto.RespuestaPushDto
import pe.queseria.campo.datos.remoto.ResultadoProductorDto
import pe.queseria.campo.datos.remoto.ResultadoRecoleccionDto
import pe.queseria.campo.datos.remoto.RutaPullDto
import pe.queseria.campo.registro.ArmadoRecoleccion
import pe.queseria.campo.registro.NuevaRecoleccion
import java.math.BigDecimal
import java.time.Instant
import java.util.UUID

/** Cola de envío y motor de sincronización contra una base y un servidor falsos (en memoria). */
class MotorSyncTest {

    // ------------------------------------------------------------- base falsa
    private class DaoEnMemoria : SyncDao() {
        val productores = linkedMapOf<String, ProductorEntidad>()
        val recolecciones = linkedMapOf<String, RecoleccionEntidad>()
        val rutas = linkedMapOf<Long, RutaEntidad>()
        val estados = linkedMapOf<Long, EstadoProductorEntidad>()
        val metas = mutableMapOf<String, String?>()

        override suspend fun insertarRecoleccion(r: RecoleccionEntidad) { check(recolecciones.put(r.id, r) == null) }
        override suspend fun insertarProductor(p: ProductorEntidad) { check(productores.put(p.clave, p) == null) }
        override suspend fun productoresPendientes(limite: Int) =
            productores.values.filter { it.estadoSync == EstadoSync.PENDIENTE }.sortedBy { it.creadoEnMs }.take(limite)
        override suspend fun recoleccionesPendientes(limite: Int) =
            recolecciones.values.filter { it.estadoSync == EstadoSync.PENDIENTE }.sortedBy { it.registradaEnMs }.take(limite)
        override suspend fun productorSincronizado(clave: String, servidorId: Long?, codigo: String?) {
            productores.computeIfPresent(clave) { _, p ->
                p.copy(estadoSync = EstadoSync.SINCRONIZADO, motivo = null,
                       servidorId = servidorId ?: p.servidorId, codigo = codigo ?: p.codigo)
            }
        }
        override suspend fun productorRechazado(clave: String, motivo: String?) {
            productores.computeIfPresent(clave) { _, p -> p.copy(estadoSync = EstadoSync.RECHAZADO, motivo = motivo) }
        }
        override suspend fun recoleccionSincronizada(id: String, alertas: String?, ahora: Long) {
            recolecciones.computeIfPresent(id) { _, r ->
                r.copy(estadoSync = EstadoSync.SINCRONIZADO, alertas = alertas, motivo = null, ultimoError = null,
                       sincronizadaEnMs = ahora)
            }
        }
        override suspend fun recoleccionRechazada(id: String, motivo: String?) {
            recolecciones.computeIfPresent(id) { _, r -> r.copy(estadoSync = EstadoSync.RECHAZADO, motivo = motivo, ultimoError = null) }
        }
        override suspend fun sumarIntento(ids: List<String>, error: String?) {
            check(ids.size <= LOTE_SQL)
            ids.forEach { id -> recolecciones.computeIfPresent(id) { _, r -> r.copy(intentos = r.intentos + 1, ultimoError = error) } }
        }
        override fun observarPendientes(): Flow<Int> = flowOf(recolecciones.values.count { it.estadoSync == EstadoSync.PENDIENTE })
        override fun observarRechazadas(): Flow<List<RecoleccionEntidad>> = flowOf(emptyList())
        override suspend fun upsertRutas(rutas: List<RutaEntidad>) { rutas.forEach { this.rutas[it.id] = it } }
        override suspend fun upsertProductores(productores: List<ProductorEntidad>) { productores.forEach { this.productores[it.clave] = it } }
        override suspend fun idsRutas() = rutas.keys.toList()
        override suspend fun borrarRutas(ids: List<Long>) { ids.forEach { rutas.remove(it) } }
        override suspend fun idsProductoresDelServidor() =
            productores.values.filter { it.servidorId != null && it.estadoSync == EstadoSync.SINCRONIZADO }.map { it.servidorId!! }
        override suspend fun borrarProductores(ids: List<Long>) {
            productores.values.removeIf { it.servidorId in ids && it.estadoSync == EstadoSync.SINCRONIZADO }
        }
        override suspend fun borrarEstados() = estados.clear()
        override suspend fun insertarEstados(estados: List<EstadoProductorEntidad>) { estados.forEach { this.estados[it.productorId] = it } }
        override suspend fun purgarSincronizadas(antesDeMs: Long) {
            recolecciones.values.removeIf { it.estadoSync == EstadoSync.SINCRONIZADO && it.registradaEnMs < antesDeMs }
        }
        override suspend fun recoleccionesEntre(desdeMs: Long, hastaMs: Long) =
            recolecciones.values.filter { it.registradaEnMs in desdeMs until hastaMs }
        // Las consultas de pantalla no las usa el motor (se prueban en BaseLocalTest, con Room real)
        override fun observarProductores(desdeMs: Long, hastaMs: Long): Flow<List<ProductorFila>> = flowOf(emptyList())
        override fun observarProductor(clave: String, desdeMs: Long, hastaMs: Long): Flow<ProductorFila?> =
            flowOf<ProductorFila?>(null)
        override fun observarIdsRecolecciones(desdeMs: Long, hastaMs: Long): Flow<List<String>> =
            flowOf(recolecciones.values.filter { it.registradaEnMs in desdeMs until hastaMs }.map { it.id })
        override fun observarRutas(): Flow<List<RutaEntidad>> = flowOf(rutas.values.toList())
        override suspend fun meta(clave: String) = metas[clave]
        override suspend fun guardarMeta(m: MetaEntidad) { metas[m.clave] = m.valor }
        override fun observarMeta(clave: String): Flow<String?> = flowOf(metas[clave])
    }

    // ------------------------------------------------------------- servidor falso (idempotente, como el real)
    private class ServidorFalso : RemotoSync {
        val recibidas = linkedMapOf<String, String>()          // id → firma
        val productores = linkedMapOf<String, Long>()          // uuid_cliente → id
        val lotes = mutableListOf<LotePushDto>()
        val cursores = mutableListOf<String?>()
        var rechazar: (String) -> String? = { null }          // id → motivo de rechazo
        var cortarRespuesta = false                           // guarda pero la respuesta no llega
        var fallo: ErrorApp? = null
        var pull = PullAcopiadorDto(rol = "acopiador", servidorAhora = "t0", siguienteDesde = "c1")

        override suspend fun push(lote: LotePushDto): RespuestaPushDto {
            fallo?.let { throw it }
            lotes += lote
            val rp = lote.productores.mapIndexed { i, p ->
                val nuevo = p.uuidCliente !in productores
                val id = productores.getOrPut(p.uuidCliente) { 100L + productores.size }
                ResultadoProductorDto(i, p.uuidCliente, if (nuevo) "creado" else "duplicado", null, id, "P-%04d".format(id))
            }
            val rr = lote.recolecciones.mapIndexed { i, r ->
                val motivo = rechazar(r.id)
                when {
                    motivo != null -> ResultadoRecoleccionDto(i, r.id, "rechazado", motivo)
                    r.id in recibidas -> ResultadoRecoleccionDto(i, r.id, "duplicado", alertas = listOf("sin_ubicacion"))
                    else -> {
                        recibidas[r.id] = r.firma!!
                        ResultadoRecoleccionDto(i, r.id, "creado", alertas = if (r.latitud == null) listOf("sin_ubicacion") else emptyList())
                    }
                }
            }
            if (cortarRespuesta) { cortarRespuesta = false; throw ErrorApp.SinRed() }
            return RespuestaPushDto(rp, rr, "t")
        }

        override suspend fun pull(desde: String?): PullAcopiadorDto {
            fallo?.let { throw it }
            cursores += desde
            return pull
        }
    }

    private val dao = DaoEnMemoria()
    private val servidor = ServidorFalso()
    private var reloj = Instant.parse("2026-10-10T12:00:00Z").toEpochMilli()
    private val motor = MotorSync(servidor, dao, reloj = { reloj })

    private suspend fun registrar(n: Int = 1, productorId: Long? = 7, uuid: String? = null): List<RecoleccionEntidad> =
        (1..n).map { i ->
            val r = ArmadoRecoleccion.armar(
                NuevaRecoleccion(productorId, uuid, "Juana", BigDecimal("10.5"), null, null, true),
                UUID.randomUUID().toString(), Instant.ofEpochMilli(reloj + i), dao.meta(Meta.ULTIMA_FIRMA),
            ) { "firma-$it".hashCode().toString() }
            dao.insertarRecoleccion(r)
            dao.guardarMeta(MetaEntidad(Meta.ULTIMA_FIRMA, r.firma))
            r
        }

    private fun estado(id: String) = dao.recolecciones.getValue(id).estadoSync

    @Test
    fun `envia las pendientes, las marca sincronizadas y no las reenvia`() = runTest {
        val rs = registrar(3)
        val resumen = motor.sincronizar()
        assertEquals(3, resumen.recoleccionesConfirmadas)
        assertEquals(3, resumen.conAlertas)  // sin GPS → sin_ubicacion
        rs.forEach { assertEquals(EstadoSync.SINCRONIZADO, estado(it.id)) }
        assertEquals("sin_ubicacion", dao.recolecciones.getValue(rs[0].id).alertas)

        motor.sincronizar()
        assertEquals("el segundo sync no hace push", 1, servidor.lotes.size)
        assertEquals(3, servidor.recibidas.size)
    }

    @Test
    fun `si se corta la respuesta, reenvia y el servidor responde duplicado sin duplicar`() = runTest {
        val rs = registrar(2)
        servidor.cortarRespuesta = true
        try {
            motor.sincronizar(); fail("debió lanzar SinRed")
        } catch (e: ErrorApp.SinRed) { /* esperado */ }
        rs.forEach {
            val local = dao.recolecciones.getValue(it.id)
            assertEquals("nada se da por enviado sin confirmación", EstadoSync.PENDIENTE, local.estadoSync)
            assertEquals(1, local.intentos)
            assertEquals("Sin conexión con el servidor", local.ultimoError)
        }
        assertEquals("Sin conexión con el servidor", dao.metas[Meta.ULTIMO_ERROR_SYNC])

        motor.sincronizar()
        rs.forEach { assertEquals(EstadoSync.SINCRONIZADO, estado(it.id)) }
        assertEquals("el servidor guardó cada una una sola vez", 2, servidor.recibidas.size)
        assertNull(dao.metas[Meta.ULTIMO_ERROR_SYNC])
    }

    @Test
    fun `un rechazo no tumba el lote, se conserva con su motivo y no se reenvia`() = runTest {
        val rs = registrar(3)
        servidor.rechazar = { if (it == rs[1].id) "Un acopiador solo registra productores de ruta" else null }
        val resumen = motor.sincronizar()
        assertEquals(2, resumen.recoleccionesConfirmadas)
        assertEquals(1, resumen.rechazados)
        val rechazada = dao.recolecciones.getValue(rs[1].id)
        assertEquals(EstadoSync.RECHAZADO, rechazada.estadoSync)
        assertEquals("Un acopiador solo registra productores de ruta", rechazada.motivo)

        motor.sincronizar()
        assertEquals(1, servidor.lotes.size)
    }

    @Test
    fun `el productor de campo sube antes que sus recolecciones en el mismo lote`() = runTest {
        val uuid = "8f0c0000-aaaa-4bbb-8ccc-000000000001"
        dao.insertarProductor(ProductorEntidad(uuid, null, uuid, null, "Rosa Quispe", null, "951234567", 3,
            null, null, false, null, EstadoSync.PENDIENTE, null, reloj))
        val r = registrar(1, productorId = null, uuid = uuid).single()
        // Su ruta es del acopiador: el pull lo lista como vigente con el id que le dio el servidor
        servidor.pull = servidor.pull.copy(rutaIdsVigentes = listOf(3), productorIdsVigentes = listOf(100))

        motor.sincronizar()
        val lote = servidor.lotes.single()
        assertEquals(uuid, lote.productores.single().uuidCliente)
        assertEquals(uuid, lote.recolecciones.single().productorUuidCliente)
        val p = dao.productores.getValue(uuid)
        assertEquals(EstadoSync.SINCRONIZADO, p.estadoSync)
        assertEquals(100L, p.servidorId)
        assertEquals("P-0100", p.codigo)
        assertEquals(EstadoSync.SINCRONIZADO, estado(r.id))
        // Lo firmado no cambia: sigue enviándose por uuid aunque ya tenga id
        assertEquals(uuid, dao.recolecciones.getValue(r.id).productorUuidCliente)
    }

    @Test
    fun `envia por lotes de 500 como maximo`() = runTest {
        registrar(1201)
        val resumen = motor.sincronizar()
        assertEquals(listOf(500, 500, 201), servidor.lotes.map { it.recolecciones.size })
        assertEquals(1201, resumen.recoleccionesConfirmadas)
        assertEquals(3, resumen.lotes)
    }

    @Test
    fun `sesion vencida no marca nada y propaga el 401`() = runTest {
        val r = registrar(1).single()
        servidor.fallo = ErrorApp.NoAutorizado("Sesión inválida o vencida")
        try {
            motor.sincronizar(); fail("debió lanzar NoAutorizado")
        } catch (e: ErrorApp.NoAutorizado) {
            assertTrue(!e.esTransitorio)
        }
        assertEquals(EstadoSync.PENDIENTE, estado(r.id))
        assertEquals("Sesión inválida o vencida", dao.metas[Meta.ULTIMO_ERROR_SYNC])
    }

    @Test
    fun `el pull aplica cambios, borra lo no vigente y usa el cursor`() = runTest {
        dao.upsertRutas(listOf(RutaEntidad(9, "Ruta vieja", null, "t")))
        dao.upsertProductores(listOf(ProductorEntidad("id:55", 55, null, "P-0055", "Ya no está", null, null, 9,
            null, null, true, "t", EstadoSync.SINCRONIZADO, null, reloj)))
        val campo = "8f0c0000-aaaa-4bbb-8ccc-000000000002"
        dao.insertarProductor(ProductorEntidad(campo, null, campo, null, "Alta de campo", null, null, 3,
            null, null, false, null, EstadoSync.RECHAZADO, "motivo", reloj))
        val vieja = registrar(1).single().copy(estadoSync = EstadoSync.SINCRONIZADO, registradaEnMs = reloj - 8L * 86_400_000)
        dao.recolecciones[vieja.id] = vieja

        servidor.pull = PullAcopiadorDto(
            rol = "acopiador", servidorAhora = "t1", siguienteDesde = "2026-10-10T06:58:00-05:00",
            rutas = listOf(RutaPullDto(3, "Huata Norte", null, "t")),
            rutaIdsVigentes = listOf(3),
            productores = listOf(ProductorPullDto(id = 7, codigo = "P-0007", nombre = "Juana", tipo = "de_ruta",
                                                  rutaId = 3, aprobado = true, actualizadoEn = "t")),
            productorIdsVigentes = listOf(7),
            estados = listOf(pe.queseria.campo.datos.remoto.EstadoProductorDto(7, sancionado = true, bloqueado = true)),
        )
        motor.sincronizar()
        assertEquals(setOf(3L), dao.rutas.keys)
        assertEquals(setOf("id:7", campo), dao.productores.keys)   // la alta de campo no confirmada se conserva
        assertTrue(dao.estados.getValue(7).bloqueado)
        assertEquals("2026-10-10T06:58:00-05:00", dao.metas[Meta.CURSOR_PULL])
        assertTrue("purga lo confirmado de hace más de 7 días", vieja.id !in dao.recolecciones)

        motor.sincronizar()
        assertEquals(listOf(null, "2026-10-10T06:58:00-05:00"), servidor.cursores)
    }
}
