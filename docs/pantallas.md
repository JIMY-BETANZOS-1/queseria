# Pantallas del sistema

Lista de pantallas por aplicación y los objetos de `db/schema.sql` que consume cada una.
Base: el mapa "pantalla → objetos" del encabezado del esquema (solo cubre la web del admin);
las pantallas móviles se derivan de las tablas, vistas y comentarios del esquema.

Convención: **lee** = consulta; **escribe** = inserta/actualiza (las reglas las aplican los triggers).

---

## (a) Web del administrador

| # | Pantalla | Qué muestra / permite | Objetos de la base |
|---|----------|-----------------------|--------------------|
| A1 | Inicio de sesión | Entrar con correo y contraseña. | lee `usuario` (`email`, `password_hash`, `rol='admin'`) |
| A2 | Dashboard | Resultado y flujo de caja del mes, leche disponible / sin destino / por revisar / descartada, productores observados (sanción o bloqueo, con su análisis), producto por vencer, sueldo estimado de acopiadores. | lee `v_resultado_mensual`, `v_flujo_mensual`, `v_productor_observado`, `v_leche_stock`, `v_lote_disponible`, `v_acopiador_mes` |
| A3 | Mapa / Recolecciones | Lista y mapa (Leaflet) de recolecciones con color del acopiador, calidad, ubicación, alertas y estado de pago; detalle con el análisis de las alteradas. Revisar alertas (marcar revisada + resolución, libera pagos retenidos). Anular una recolección con motivo. | lee `v_recoleccion_detalle`, `alerta_recoleccion`, `analisis_calidad`; escribe `alerta_recoleccion` (`revisada_*`, `resolucion`), `recoleccion` (`anulada_*`, `motivo_anulacion`) |
| A4 | Proveedores | Lista de productores (de ruta y externos) con litros, descartes, estado de sanción y pendientes de aprobación. Crear/editar productor, aprobar altas de campo, ver su historial de recolecciones. | lee `v_productor_resumen`, `v_recoleccion_detalle`; escribe `productor` (incl. `aprobado`) |
| A5 | Acopiadores | Datos del acopiador (color, vehículo, sueldo base, comisión), rutas asignadas con historial, sueldo estimado del mes y registro del pago mensual. | lee/escribe `acopiador`, `ruta_acopiador`, `pago_acopiador`; lee `v_acopiador_mes` |
| A5b | Rutas | Crear, editar y desactivar rutas; asignar el acopiador vigente (cerrar la asignación anterior con `vigente_hasta`) y ver el historial de asignaciones. | lee/escribe `ruta`, `ruta_acopiador` |
| A6 | Control de calidad | Recolecciones sin revisar, estado de productores hoy, % de alteradas por analista, análisis de las alteradas, sanciones (crear a mano o levantar). | lee `v_recoleccion_sin_revisar`, `v_productor_estado_hoy`, `v_analista_resumen`, `analisis_calidad`; lee/escribe `sancion_productor` |
| A7 | Insumos | Stock y costo promedio por insumo; registrar ingresos (compras) y ajustes; historial de movimientos. | lee `v_insumo_stock`; lee/escribe `insumo`, `movimiento_insumo` |
| A8b | Leche de la jornada | Por día: litros recolectados, descartados, por revisar, aprobados, usados en lotes, merma y disponibles; costo por litro útil; jornadas "sin destino" resaltadas. Registrar merma de leche con motivo; ver a qué lotes fue la leche de cada jornada. | lee `v_leche_jornada`, `lote_leche`; lee/escribe `merma_leche` |
| A8 | Recetas | Las 4 recetas: precio, rendimiento por 100 L, vida útil e insumos por 100 L. | lee/escribe `receta`, `receta_insumo` |
| A9 | Producción (lotes) | Crear lote, asignar leche de jornadas (a costo por litro útil), consumir insumos, registrar costos propios, cerrar con cantidad producida; hoja de costos y rendimiento real vs. teórico. | lee `v_leche_jornada`, `v_lote_resumen`, `receta`, `receta_insumo`; escribe `lote_produccion`, `lote_leche`, `lote_costo`, `movimiento_insumo` (`consumo_lote`) |
| A10 | Ventas | Venta al contado a un cliente desde lotes con saldo (el que vence primero arriba); bajas de producto (merma, vencido, muestra); clientes. | lee `v_lote_disponible`; lee/escribe `cliente`, `venta`, `venta_detalle`, `baja_producto` |
| A11 | Pagos a productores | Cuentas por pagar (pagable y en espera); generar liquidación semanal con las recolecciones pagables del periodo, marcarla pagada, comprobante PDF. | lee `v_pago_pendiente_productor`, `v_liquidacion_productor`, `v_recoleccion_pago`; lee/escribe `liquidacion_productor`, `liquidacion_detalle` |
| A12 | Gastos | Gastos operativos por categoría (opcionalmente por acopiador). | lee/escribe `gasto_operativo`; lee `categoria_gasto` |
| A13 | Configuración | Parámetros (sanción, GPS, alertas…), historial de precios de leche, usuarios, celulares vinculados y códigos de activación. | lee/escribe `configuracion`, `precio_leche`, `usuario`, `dispositivo`, `codigo_activacion` |
| A13b | Configuración › Historial de cambios | Solo lectura: quién cambió qué y cuándo (precios, sanciones, pagos, calidad, anulaciones…), filtrable por tabla, usuario y fecha, con el antes/después. | lee `auditoria` |

---

## (b) App del acopiador (móvil, offline)

| # | Pantalla | Qué muestra / permite | Objetos de la base |
|---|----------|-----------------------|--------------------|
| B1 | Vincular celular | Ingresar el código que generó el admin (una sola vez); registra el dispositivo y su clave pública. | lee/escribe `codigo_activacion` (`usado_en`); escribe `dispositivo` |
| B2 | Ingreso con PIN | Teclado con dígitos mezclados; bloqueo tras intentos fallidos; cambiar PIN. | lee/escribe `usuario` (`pin_hash`, `pin_intentos_fallidos`, `bloqueado_hasta`, `pin_actualizado_en`) |
| B3 | Mis productores | Productores de SUS rutas vigentes; nombre en rojo si está sancionado o bloqueado. Por productor, el total del día y cuántas entregas lo componen ("✓ 23.50 L hoy · 2 entregas") o "Pendiente"; el total junta lo de este celular con lo que el servidor ya tiene de hoy (`GET /acopiador/mi-dia`), así un celular reinstalado no muestra "Pendiente" a quien ya entregó. Si ya entregó hoy, al tocarlo se avisa con los litros ya registrados y se pide confirmación ("Sí, otra entrega" / "Cancelar") antes de abrir B4. | lee `productor`, `ruta`, `ruta_acopiador`, `v_productor_estado_hoy` (pull por `actualizado_en`) |
| B4 | Registrar recolección | Litros con el teclado propio de la app **en orden fijo** (1-2-3 arriba; el barajado es solo del PIN en B2) + observación; GPS, precisión, ubicación simulada, hora GPS, hora automática, firma y `hash_anterior`. Se guarda sin GPS (`origen_ubicacion='ninguna'`). Si el productor está bloqueado: aviso rojo "Productor bloqueado, no debe entregar leche"; si el acopiador confirma que la recibió, se registra igual (la base crea la alerta `productor_bloqueado` y retiene el pago). Un productor puede tener VARIAS recolecciones el mismo día (la base no lo limita): cada una lleva su propio UUID de cliente y suma al total del día; si ya entregó hoy se recuerda cuánto. Un toque = una recolección: GUARDAR se deshabilita al instante, porque un doble toque sería indistinguible de una segunda entrega real. | escribe `recoleccion` (UUID del celular); lee `v_productor_estado_hoy` |
| B5 | Alta de productor en campo | Crear productor de ruta sin internet (nace no aprobado). | escribe `productor` (`uuid_cliente`, `creado_por`) |
| B6 | Mi día | Recolecciones del día, litros totales y estado de sincronización. | lee `recoleccion` (filtrada por `registrado_por` y fecha) |
| B7 | Sincronización | Subir productores nuevos, luego recolecciones; bajar cambios. | `productor`, `recoleccion` (`ON CONFLICT DO NOTHING`), pull por `actualizado_en` |

---

## (c) App del analista (móvil)

| # | Pantalla | Qué muestra / permite | Objetos de la base |
|---|----------|-----------------------|--------------------|
| C1 | Vincular celular | Igual que B1. | `codigo_activacion`, `dispositivo` |
| C2 | Ingreso con PIN | Igual que B2. | `usuario` |
| C3 | Por revisar | Recolecciones pendientes de revisión; buscar o escanear el QR del tarro (`codigo` del productor). | lee `v_recoleccion_sin_revisar` |
| C4 | Revisar recolección | Confirmar normal (por defecto) o marcar alterada con su análisis (ph, temperatura, grasa, densidad, antibióticos o foto). Muestra estado del productor. | escribe `recoleccion` (`estado_calidad`, `calidad_por`, `calidad_en`), `analisis_calidad`; lee `v_productor_estado_hoy` |
| C5 | Productores externos | Registrar productor externo (documento y celular obligatorios). | lee/escribe `productor` (`tipo='externo'`) |
| C6 | Recibir leche externa | Registrar recolección de un externo en planta. | escribe `recoleccion` |
| C7 | Mi resumen | Revisadas y % de alteradas del mes. | lee `v_analista_resumen` (filtrada por `analista_id`) |

---

## Huecos

### Resueltos
- **Productor bloqueado (B4)**: la app avisa en rojo y, si el acopiador confirma, registra igual; la base crea
  la alerta `productor_bloqueado` y retiene el pago. Corregido el comentario de `v_productor_estado_hoy` y `CLAUDE.md`.
- **`merma_leche`** → pantalla "Leche de la jornada" (A8b).
- **`ruta`** → pantalla "Rutas" (A5b).
- **`auditoria`** → "Historial de cambios" dentro de Configuración (A13b), solo lectura.
- **`analisis_calidad`** y **`liquidacion_detalle`** → agregados al mapa del esquema (A3, A6, A11).
- **`actualizado_en`** → anotado en el mapa del esquema: lo usa la sincronización móvil (Fase 2).
- **Mi día del acopiador (B6)** → `GET /acopiador/mi-dia` (lo ya sincronizado, desde `v_recoleccion_detalle`);
  el móvil suma lo pendiente de Room (Fase 2).
- **Por revisar del analista (C3)** → el pull envía `v_recoleccion_sin_revisar` completa y `recolecciones_hoy`
  incremental leyendo `recoleccion.actualizado_en` (Fase 2, ver `docs/sincronizacion.md`).

### Pendientes (no bloquean; se revisan en la fase indicada)
1. **Observaciones del esquema** (Fase 2): el acopiador puede registrar productores de rutas que no son suyas
   y se puede anular una recolección ya liquidada. Detalle en `docs/sincronizacion.md`.
2. **`productor`** (tabla): el mapa solo lista `v_productor_resumen`, pero Proveedores (A4) escribe en `productor`.
3. **`v_recoleccion_pago`**: no figura en el mapa; la usa Pagos (A11) para elegir qué recolecciones entran a la liquidación.
4. **Funciones internas** (`fn_precio_leche`, `fn_en_sancion`, `fn_leche_disponible`, `fn_saldo_lote`,
   `fn_costo_litro_jornada`, `fn_distancia_m`, `fn_lote_abierto`): las usan triggers y vistas; ninguna pantalla las
   necesita. `fn_leche_disponible` y `fn_saldo_lote` pueden servir para validar en el formulario antes de guardar.
