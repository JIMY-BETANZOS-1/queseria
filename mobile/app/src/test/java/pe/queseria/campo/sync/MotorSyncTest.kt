package pe.queseria.campo.sync

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import pe.queseria.campo.datos.local.AnalistaDao
import pe.queseria.campo.datos.local.EntregaRetenidaFila
import pe.queseria.campo.datos.local.EstadoReporte
import pe.queseria.campo.datos.local.EstadoProductorEntidad
import pe.queseria.campo.datos.local.EstadoSync
import pe.queseria.campo.datos.local.Meta
import pe.queseria.campo.datos.local.MetaEntidad
import pe.queseria.campo.datos.local.ProductorEntidad
import pe.queseria.campo.datos.local.ProductorAnalistaFila
import pe.queseria.campo.datos.local.ProductorFila
import pe.queseria.campo.datos.local.RecoleccionEntidad
import pe.queseria.campo.datos.local.ReporteAnalistaEntidad
import pe.queseria.campo.datos.local.RutaEntidad
import pe.queseria.campo.datos.local.SyncDao
import pe.queseria.campo.datos.remoto.ErrorApp
import pe.queseria.campo.datos.remoto.LotePushDto
import pe.queseria.campo.datos.remoto.ProductorPullDto
import pe.queseria.campo.datos.remoto.PullAcopiadorDto
import pe.queseria.campo.datos.remoto.PullAnalistaDto
import pe.queseria.campo.datos.remoto.PullSyncDto
import pe.queseria.campo.datos.remoto.ReporteGuardadoDto
import pe.queseria.campo.datos.remoto.RespuestaPushDto
import pe.queseria.campo.datos.remoto.ResultadoProductorDto
import pe.queseria.campo.datos.remoto.ResultadoRecoleccionDto
import pe.queseria.campo.datos.remoto.RutaPullDto
import pe.queseria.campo.registro.ArmadoRecoleccion
import pe.queseria.campo.registro.NuevaRecoleccion
import pe.queseria.campo.ui.analista.Reportes
import java.math.BigDecimal
import java.time.Instant
import java.util.UUID

/** Motivo literal del backend cuando la recolección apunta a un productor que no existe. */
private const val MSG_SIN_PRODUCTOR = "El productor no está registrado (súbalo antes que sus recolecciones)"

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
        override fun observarProductoresPendientes(): Flow<Int> =
            flowOf(productores.values.count { it.estadoSync == EstadoSync.PENDIENTE })
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
        override suspend fun productoresLocales(): List<ProductorEntidad> =
            productores.values.filter { it.estadoSync != EstadoSync.RECHAZADO }
        override fun observarProductoresRechazados(): Flow<List<ProductorEntidad>> =
            flowOf(productores.values.filter { it.estadoSync == EstadoSync.RECHAZADO })
        override fun observarEntregasRetenidas(): Flow<List<EntregaRetenidaFila>> = flowOf(
            recolecciones.values.filter { it.estadoSync == EstadoSync.RECHAZADO }.mapNotNull { r ->
                val p = productores.values.firstOrNull {
                    it.uuidCliente != null && it.uuidCliente == r.productorUuidCliente &&
                        it.estadoSync == EstadoSync.RECHAZADO
                } ?: return@mapNotNull null
                EntregaRetenidaFila(r.id, r.litros, r.registradaEnMs, p.nombre, p.motivo, p.clave)
            },
        )
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
        var rechazarProductor: (String) -> String? = { null } // uuid_cliente → motivo de rechazo
        var cortarRespuesta = false                           // guarda pero la respuesta no llega
        var fallo: ErrorApp? = null
        var pull: PullSyncDto = PullAcopiadorDto(rol = "acopiador", servidorAhora = "t0", siguienteDesde = "c1")
        /** (uuid_reporte, productor_id, productor_uuid_cliente) de cada reporte recibido. */
        val reportes = mutableListOf<Triple<String, Long?, String?>>()
        var falloReporte: (String) -> ErrorApp? = { null }

        override suspend fun push(lote: LotePushDto): RespuestaPushDto {
            fallo?.let { throw it }
            lotes += lote
            val rp = lote.productores.mapIndexed { i, p ->
                val motivo = rechazarProductor(p.uuidCliente)
                if (motivo != null) {
                    ResultadoProductorDto(i, p.uuidCliente, "rechazado", motivo)
                } else {
                    val nuevo = p.uuidCliente !in productores
                    val id = productores.getOrPut(p.uuidCliente) { 100L + productores.size }
                    ResultadoProductorDto(i, p.uuidCliente, if (nuevo) "creado" else "duplicado", null, id, "P-%04d".format(id))
                }
            }
            val rr = lote.recolecciones.mapIndexed { i, r ->
                val motivo = rechazar(r.id)
                when {
                    motivo != null -> ResultadoRecoleccionDto(i, r.id, "rechazado", motivo)
                    // Como el backend: sin productor no hay recolección (routers/sync.py)
                    r.productorUuidCliente != null && r.productorUuidCliente !in productores ->
                        ResultadoRecoleccionDto(i, r.id, "rechazado", MSG_SIN_PRODUCTOR)
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

        override suspend fun subirReporte(uuidReporte: String, productorId: Long?, productorUuidCliente: String?,
                                          rutaFoto: String): ReporteGuardadoDto {
            falloReporte(uuidReporte)?.let { throw it }
            reportes += Triple(uuidReporte, productorId, productorUuidCliente)
            return ReporteGuardadoDto(uuidReporte, "creado", "rec-1", "analisis/reporte-$uuidReporte.jpg")
        }

        override suspend fun pull(desde: String?): PullSyncDto {
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
        servidor.pull = (servidor.pull as PullAcopiadorDto).copy(rutaIdsVigentes = listOf(3), productorIdsVigentes = listOf(100))

        motor.sincronizar()
        val lote = servidor.lotes.single()
        assertEquals(uuid, lote.productores.single().uuidCliente)
        assertEquals(uuid, lote.recolecciones.single().productorUuidCliente)
        // El contrato exige uno de los dos, nunca ambos (RecoleccionPush._un_productor)
        assertNull(lote.recolecciones.single().productorId)
        val p = dao.productores.getValue(uuid)
        assertEquals(EstadoSync.SINCRONIZADO, p.estadoSync)
        assertEquals(100L, p.servidorId)
        assertEquals("P-0100", p.codigo)
        assertEquals(EstadoSync.SINCRONIZADO, estado(r.id))
        // Lo firmado no cambia: sigue enviándose por uuid aunque ya tenga id
        assertEquals(uuid, dao.recolecciones.getValue(r.id).productorUuidCliente)
    }

    /**
     * Partir en lotes no puede dejar la leche antes que su productor: el servidor rechaza una
     * recolección cuyo productor todavía no existe, y esa leche ya no se puede reasignar (pendiente (H)).
     */
    @Test
    fun `con varios lotes el alta de campo viaja en el primero, antes que su leche`() = runTest {
        val uuid = "8f0c0000-aaaa-4bbb-8ccc-000000000003"
        dao.insertarProductor(ProductorEntidad(uuid, null, uuid, null, "Rosa Quispe", null, null, 3,
            null, null, false, null, EstadoSync.PENDIENTE, null, reloj))
        val rs = registrar(600, productorId = null, uuid = uuid)
        servidor.pull = (servidor.pull as PullAcopiadorDto).copy(rutaIdsVigentes = listOf(3), productorIdsVigentes = listOf(100))

        val resumen = motor.sincronizar()

        assertEquals(listOf(500, 100), servidor.lotes.map { it.recolecciones.size })
        assertEquals("el productor va en el primer lote", 1, servidor.lotes[0].productores.size)
        assertEquals("y no se repite en el segundo", 0, servidor.lotes[1].productores.size)
        assertEquals(600, resumen.recoleccionesConfirmadas)
        assertEquals("ninguna leche se rechazó por falta de productor", 0, resumen.rechazados)
        rs.forEach { assertEquals(EstadoSync.SINCRONIZADO, estado(it.id)) }
    }

    @Test
    fun `un alta de productor rechazada no tumba el resto del lote`() = runTest {
        val uuid = "8f0c0000-aaaa-4bbb-8ccc-000000000004"
        dao.insertarProductor(ProductorEntidad(uuid, null, uuid, null, "Rosa Quispe", "41234567", null, 3,
            null, null, false, null, EstadoSync.PENDIENTE, null, reloj))
        // Leche de productores que sí existen en el servidor, en el mismo lote que el alta rechazada
        val otras = registrar(2, productorId = 7)
        servidor.rechazarProductor = { "Ya existe un productor con ese documento" }

        val resumen = motor.sincronizar()

        val p = dao.productores.getValue(uuid)
        assertEquals(EstadoSync.RECHAZADO, p.estadoSync)
        assertEquals("Ya existe un productor con ese documento", p.motivo)
        otras.forEach { assertEquals("lo demás del lote sigue su curso", EstadoSync.SINCRONIZADO, estado(it.id)) }
        assertEquals(2, resumen.recoleccionesConfirmadas)
        assertEquals(1, resumen.rechazados)
        assertEquals("un alta rechazada no es un productor enviado", 0, resumen.productoresEnviados)
        assertEquals(1, resumen.productoresRechazados)
        assertEquals(0, resumen.recoleccionesRechazadas)

        // Y no se reintenta: el alta rechazada se conserva con su motivo
        motor.sincronizar()
        assertEquals(1, servidor.lotes.size)
    }

    /**
     * Si el alta se rechaza, su leche se rechaza por arrastre. No se pierde: queda en la base con sus
     * litros y el motivo del productor, que es lo que B7 muestra como "entrega retenida" (pendiente (H)).
     */
    @Test
    fun `la leche de un alta rechazada se conserva y se puede emparejar con su productor`() = runTest {
        val uuid = "8f0c0000-aaaa-4bbb-8ccc-000000000005"
        dao.insertarProductor(ProductorEntidad(uuid, null, uuid, null, "Rosa Quispe", "41234567", null, 3,
            null, null, false, null, EstadoSync.PENDIENTE, null, reloj))
        val suya = registrar(1, productorId = null, uuid = uuid).single()
        servidor.rechazarProductor = { "Ya existe un productor con ese documento" }

        motor.sincronizar()

        val rechazada = dao.recolecciones.getValue(suya.id)
        assertEquals("la leche no se borra", EstadoSync.RECHAZADO, rechazada.estadoSync)
        assertEquals("10.50", rechazada.litros)
        assertEquals(MSG_SIN_PRODUCTOR, rechazada.motivo)

        // El motivo útil es el del productor: el de la recolección engaña (sí se subió, en el mismo lote)
        val retenida = dao.observarEntregasRetenidas().first().single()
        assertEquals(suya.id, retenida.id)
        assertEquals("Rosa Quispe", retenida.productor)
        assertEquals("10.50", retenida.litros)
        assertEquals("Ya existe un productor con ese documento", retenida.motivoProductor)
    }

    /** Antes salía "1 productor · 1 rechazada" y parecía que el productor sí se había enviado. */
    @Test
    fun `en un lote con un alta aceptada y otra rechazada solo la aceptada cuenta como enviada`() = runTest {
        val buena = "8f0c0000-aaaa-4bbb-8ccc-000000000006"
        val mala = "8f0c0000-aaaa-4bbb-8ccc-000000000007"
        dao.insertarProductor(ProductorEntidad(buena, null, buena, null, "Ana Condori", null, null, 3,
            null, null, false, null, EstadoSync.PENDIENTE, null, reloj))
        dao.insertarProductor(ProductorEntidad(mala, null, mala, null, "Rosa Quispe", "41234567", null, 3,
            null, null, false, null, EstadoSync.PENDIENTE, null, reloj + 1))
        registrar(1, productorId = null, uuid = mala)
        servidor.rechazarProductor = { if (it == mala) "Ya existe un productor con ese documento" else null }

        val resumen = motor.sincronizar()

        assertEquals(1, resumen.productoresEnviados)
        assertEquals(1, resumen.productoresRechazados)
        assertEquals("su leche se rechaza por arrastre", 1, resumen.recoleccionesRechazadas)
        assertEquals(2, resumen.rechazados)
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

    // ------------------------------------------------------------- analista: reportes y pull de todas las rutas
    private class AnalistaDaoEnMemoria(private val base: DaoEnMemoria) : AnalistaDao() {
        val reportes = linkedMapOf<String, ReporteAnalistaEntidad>()
        override suspend fun insertarReporte(r: ReporteAnalistaEntidad) { check(reportes.put(r.id, r) == null) }
        override suspend fun reportesPorEnviar() =
            reportes.values.filter { it.estado == EstadoReporte.PENDIENTE }.sortedBy { it.creadoEnMs }
        override suspend fun reporteEnviado(id: String, ahora: Long) {
            reportes.computeIfPresent(id) { _, r -> r.copy(estado = EstadoReporte.ENVIADO, motivo = null, enviadoEnMs = ahora) }
        }
        override suspend fun reporteRechazado(id: String, motivo: String?) {
            reportes.computeIfPresent(id) { _, r -> r.copy(estado = EstadoReporte.RECHAZADO, motivo = motivo) }
        }
        override suspend fun reporteReintentar(id: String, motivo: String?) {
            reportes.computeIfPresent(id) { _, r -> r.copy(intentos = r.intentos + 1, motivo = motivo) }
        }
        override fun observarReportes(clave: String): Flow<List<ReporteAnalistaEntidad>> =
            flowOf(reportes.values.filter { it.productorClave == clave })
        override fun observarPorEnviar(): Flow<Int> = flowOf(reportes.values.count { it.estado == EstadoReporte.PENDIENTE })
        override fun observarProductores(): Flow<List<ProductorAnalistaFila>> = flowOf(emptyList())
        override suspend fun productor(clave: String) = base.productores[clave]
        override fun observarAltasRechazadas(): Flow<List<ProductorEntidad>> = flowOf(emptyList())
    }

    private val analistaDao = AnalistaDaoEnMemoria(dao)
    private val motorAnalista = MotorSync(servidor, dao, reloj = { reloj }, analistaDao = analistaDao)

    private fun pullAnalista(vararg productores: ProductorPullDto) = PullAnalistaDto(
        rol = "analista", servidorAhora = "t1", siguienteDesde = "c-analista",
        rutas = listOf(RutaPullDto(1, "Ruta 1", null, "t"), RutaPullDto(2, "Ruta 2", null, "t")),
        rutaIdsVigentes = listOf(1, 2), productores = productores.toList(),
        productorIdsVigentes = productores.map { it.id },
    )

    private val cirilo = ProductorPullDto(id = 7, codigo = "P-0007", nombre = "Cirilo", tipo = "de_ruta", rutaId = 2,
                                          aprobado = true, actualizadoEn = "t")

    @Test
    fun `el analista baja productores de todas las rutas y externos, sin precios ni entregas`() = runTest {
        val externo = ProductorPullDto(id = 16, codigo = "P-0016", nombre = "Agropecuaria", tipo = "externo",
                                       aprobado = true, actualizadoEn = "t")
        val mario = cirilo.copy(id = 1, codigo = "P-0001", nombre = "Mario", rutaId = 1)
        servidor.pull = pullAnalista(mario, cirilo, externo)
        motorAnalista.sincronizar()
        assertEquals(setOf("id:1", "id:7", "id:16"), dao.productores.keys)
        assertEquals(setOf(1L, 2L), dao.rutas.keys)
        assertNull(dao.productores.getValue("id:16").rutaId)
        assertEquals("c-analista", dao.metas[Meta.CURSOR_PULL])
        assertTrue(Meta.PRECIOS !in dao.metas)
        assertTrue(servidor.lotes.isEmpty())                       // nada que subir: no sincroniza entregas
    }

    @Test
    fun `reporte con foto se envia una vez y solo comentario se queda en el celular`() = runTest {
        servidor.pull = pullAnalista(cirilo)
        motorAnalista.sincronizar()
        val conFoto = Reportes.nuevo("id:7", "Cirilo", "Tarro sucio", "/fotos/a.jpg", reloj)
        val soloTexto = Reportes.nuevo("id:7", "Cirilo", "Volver el lunes", null, reloj + 1)
        analistaDao.insertarReporte(conFoto)
        analistaDao.insertarReporte(soloTexto)

        val r = motorAnalista.sincronizar()
        assertEquals(1, r.reportesEnviados)
        assertEquals(listOf(Triple(conFoto.id, 7L, null as String?)), servidor.reportes)
        assertEquals(EstadoReporte.ENVIADO, analistaDao.reportes.getValue(conFoto.id).estado)
        assertEquals(EstadoReporte.SOLO_CELULAR, analistaDao.reportes.getValue(soloTexto.id).estado)
        motorAnalista.sincronizar()
        assertEquals(1, servidor.reportes.size)                    // no se reenvía
    }

    @Test
    fun `externo dado de alta sin senal se sube antes que su reporte`() = runTest {
        servidor.pull = pullAnalista()
        val uuid = "8f0c0000-aaaa-4bbb-8ccc-000000000009"
        dao.insertarProductor(ProductorEntidad(uuid, null, uuid, null, "Marcelino", "40111217", "955200003", null,
            null, null, true, null, EstadoSync.PENDIENTE, null, reloj))
        val reporte = Reportes.nuevo(uuid, "Marcelino", "", "/fotos/b.jpg", reloj)
        analistaDao.insertarReporte(reporte)

        motorAnalista.sincronizar()
        assertEquals(uuid, servidor.lotes.single().productores.single().uuidCliente)
        // Ya confirmado por el servidor, el reporte va con su id (no con el uuid del celular)
        assertEquals(Triple(reporte.id, 100L, null as String?), servidor.reportes.single())
    }

    @Test
    fun `409 sin entrega deja el reporte en cola, 422 lo rechaza y sin red reintenta`() = runTest {
        servidor.pull = pullAnalista(cirilo)
        motorAnalista.sincronizar()
        val espera = Reportes.nuevo("id:7", "Cirilo", "", "/fotos/c.jpg", reloj)
        val mala = Reportes.nuevo("id:7", "Cirilo", "", "/fotos/d.jpg", reloj + 1)
        analistaDao.insertarReporte(espera)
        analistaDao.insertarReporte(mala)
        servidor.falloReporte = {
            when (it) {
                espera.id -> ErrorApp.Conflicto("El productor no tiene una entrega libre")
                else -> ErrorApp.Validacion("El archivo debe ser una imagen JPEG, PNG o WebP")
            }
        }
        motorAnalista.sincronizar()                                // 409 y 422 no cortan la sincronización
        analistaDao.reportes.getValue(espera.id).let {
            assertEquals(EstadoReporte.PENDIENTE, it.estado)
            assertEquals(1, it.intentos)
            assertEquals("El productor no tiene una entrega libre", it.motivo)
        }
        assertEquals(EstadoReporte.RECHAZADO, analistaDao.reportes.getValue(mala.id).estado)

        servidor.falloReporte = { ErrorApp.SinRed() }
        try {
            motorAnalista.sincronizar(); fail("debió lanzar SinRed")
        } catch (e: ErrorApp.SinRed) {
            assertTrue(e.esTransitorio)                            // WorkManager reintenta
        }
        assertEquals(EstadoReporte.PENDIENTE, analistaDao.reportes.getValue(espera.id).estado)

        servidor.falloReporte = { null }
        motorAnalista.sincronizar()
        assertEquals(EstadoReporte.ENVIADO, analistaDao.reportes.getValue(espera.id).estado)
    }
}
