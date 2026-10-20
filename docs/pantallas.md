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

### Estado en el panel web (Bloques W1 y W2)
El panel (`web/`) reemplaza el uso diario de `/docs`. Lo que no está aquí se sigue haciendo por `/docs`.

| # | En el panel | Falta (siguiente fase) |
|---|-------------|------------------------|
| A1 | Completa (W1). | — |
| A2 | Mínimo (W2): **Dashboard** del mes con lo que requiere atención, leche, dinero (flujo y resultado de la base, con los ingresos de Ventas) y gráfico de 14 días en SVG. | Más gráficos. |
| A3 | Parcial (W1): **Alertas** y **Recolecciones del día** (resumen por persona, ubicación como texto, anular con motivo). | Mapa (Leaflet), rangos de fechas. |
| A4 | Parcial (W1): **Productores** (altas de campo pendientes primero, crear y editar, aprobar, últimas 50 entregas con su pago). El tipo no se edita. | Historial completo por fechas, litros por periodo. |
| A5 | Parcial: **Acopiadores** (W1) y **Pagos a acopiadores** (W2: estimado del mes, registrar con ajustes, marcar pagado). | — |
| A5b | Completa (W1): **Rutas**. | — |
| A6 | Mínima (W2): **Calidad**: el admin marca normales en lote o alterada con análisis, mientras no exista la app del analista. | Productores observados, crear o levantar sanciones, % por analista. |
| A7 | W2: **Almacén**: stock, costo promedio ponderado, valor del inventario, "sin stock" y "alcanza para ≈ N L de leche" (en la receta que más usa el insumo); **registrar compras** (la base recalcula el costo promedio) y **crear insumos** (nombre y unidad). | Ajustes de inventario, historial de movimientos; stock mínimo por insumo (necesita `stock_minimo` en `db/`). |
| A8b | W2: **Leche de la jornada** (v_leche_jornada), con "sin destino" y "sin leche aprobada"; **registrar merma** con motivo en las jornadas con leche disponible (la base decide si cabe). | Ver a qué lotes fue la leche; listar las mermas de una jornada (el backend ya tiene `GET /mermas`). |
| A8 | Solo lectura (W2): **Recetas**: unidad de venta, precio, rendimiento y vida útil, insumos por 100 L con su costo de hoy, y "alcanza para" con el stock actual. | Editar recetas. |
| A9 | Rápida (W2): **Producción** en un paso: receta, leche de una jornada (la más antigua preseleccionada), insumos sugeridos por la receta con "necesita / hay / falta reponer" (bloquea si falta) y cierre con lo producido (propuesto con el rendimiento teórico). | Lote por etapas, leche de varias jornadas, costos propios (luz, mano de obra), bajas. |
| A10 | Rápida (W2): **Ventas** al contado de una línea desde un lote cerrado con saldo (no vencido), con cliente nuevo en el momento. | Varias líneas por venta, bajas de producto, anular una venta. |
| A11 | Completa (W2): **Pagos a productores**: por pagar, liquidar periodo (con lo que queda en espera), comprobante imprimible, marcar pagada, eliminar pendientes. | Comprobante en PDF (ReportLab no está instalado). |
| A12 | Mínima (W2): **Gastos**: listar por rango y registrar (sin editar ni eliminar; sin "Sueldo acopiador"). | Editar o anular un gasto. |
| A12b | Nueva (W2): **Movimientos** del mes, solo lectura: ventas, pagos a productores (pago real), compras de insumos, gastos (sueldos una vez), costos de lote, y mermas y bajas como pérdida; filtro por mes y tipo; enlace a la liquidación. | Exportar a hoja de cálculo; filtro por rango de fechas. |
| A13 | Parcial: **Analistas** y acceso móvil (W1); **Configuración** con precio de la leche y parámetros (W2). | — |
| A13b | — | **Historial de cambios** (auditoría, solo lectura). |

---

## (b) App del acopiador (móvil, offline)

| # | Pantalla | Qué muestra / permite | Objetos de la base |
|---|----------|-----------------------|--------------------|
| B1 | Vincular celular | Tres etapas, con red: **código** que generó el admin (8 caracteres, un solo uso, vence a los 60 min) → **"Cree su PIN"** → **"Repita su PIN"**. El PIN lo crea el propio usuario: **exactamente 4 dígitos**, teclado barajado, sin OK (avanza solo al 4.º dígito). Un PIN trivial (todos iguales, secuencias, 1212, 1122, o los últimos 4 del DNI o celular, ver `seguridad.pin_trivial`) se avisa al momento y el servidor lo rechaza igual (422) sin gastar el código; si los dos PIN no coinciden, se vuelve a crear. Al activar, el servidor devuelve el token y se entra directo a B3. **Reactivar** (PIN olvidado o bloqueado: el admin genera otro código) reemplaza el PIN y quita el bloqueo, y **no pierde nada**: misma clave de firma del Keystore, mismo `dispositivo`, Room intacto; con algo sin enviar y la clave de firma perdida no activa ("Sincronice primero"). Con pendientes y sesión vigente ofrece "Sincronizar ahora"; si se llegó desde "¿Olvidó su PIN?", "Volver al PIN". | lee/escribe `codigo_activacion` (`usado_en`), `usuario` (`pin_hash`, `pin_actualizado_en`); escribe `dispositivo` |
| B2 | Ingreso con PIN | Teclado con dígitos mezclados y **sin OK: se verifica solo al teclear el 4.º dígito**. Una entrada incompleta nunca se envía ni cuenta como intento; solo cuenta un PIN completo que falla. 5 intentos → bloqueo de 15 min (en el servidor y, sin red, en el celular). Botón **"¿Olvidó su PIN? Tengo un código nuevo"** (también con el PIN bloqueado): lleva a B1 sin borrar nada. Un usuario con PIN puesto por el admin con el sistema anterior recibe `debe_reactivar` y vuelve a B1 sin contar fallo. Ya no hay cambio de PIN en la app (B2b y su "opción C" se quitaron en el Bloque 6). | lee/escribe `usuario` (`pin_hash`, `pin_intentos_fallidos`, `bloqueado_hasta`, `pin_actualizado_en`) |
| B3 | Mi jornada y mis productores | **Dashboard de la jornada** arriba: tarjeta "HOY" con los litros del día en grande y negrita, número de entregas y "X de Y productores atendidos" (salen de las mismas filas de la lista, ya fusionadas con el servidor, así tarjeta y lista no se contradicen), más una pastilla de envío ("✓ Todo enviado" / "N sin enviar" en ámbar / "Sin señal · N sin enviar" / "N rechazada(s)" en rojo, contando solo los rechazos aún no marcados "Ya avisé" en B7) que abre B7; toda la tarjeta abre B6 ("Ver mi día ›"). Debajo, botón principal **REGISTRAR LECHE** (64 dp) que lleva al buscador y le da foco: registrar cuesta 1 toque (el productor, si ya se ve) o 2 (botón → productor). "+ Productor" y "Sincronizar" como secundarios (56 dp, dos por fila). Todo va en una sola lista desplazable. Luego, productores de SUS rutas vigentes; nombre en rojo si está sancionado o bloqueado. Por productor, el total del día y cuántas entregas lo componen ("✓ 23.50 L hoy · 2 entregas") o "Pendiente"; el total junta lo de este celular con lo que el servidor ya tiene de hoy (`GET /acopiador/mi-dia`), así un celular reinstalado no muestra "Pendiente" a quien ya entregó. Si ya entregó hoy, al tocarlo se avisa con los litros ya registrados y se pide confirmación ("Sí, otra entrega" / "Cancelar") antes de abrir B4. | lee `productor`, `ruta`, `ruta_acopiador`, `v_productor_estado_hoy` (pull por `actualizado_en`) |
| B4 | Registrar recolección | Litros con el teclado propio de la app **en orden fijo** (1-2-3 arriba; el barajado es solo del PIN en B2) + observación; GPS, precisión, ubicación simulada, hora GPS, hora automática, firma y `hash_anterior`. Se guarda sin GPS (`origen_ubicacion='ninguna'`). Si el productor está bloqueado: aviso rojo "Productor bloqueado, no debe entregar leche"; si el acopiador confirma que la recibió, se registra igual (la base crea la alerta `productor_bloqueado` y retiene el pago). Un productor puede tener VARIAS recolecciones el mismo día (la base no lo limita): cada una lleva su propio UUID de cliente y suma al total del día; si ya entregó hoy se recuerda cuánto. Un toque = una recolección: GUARDAR se deshabilita al instante, porque un doble toque sería indistinguible de una segunda entrega real. | escribe `recoleccion` (UUID del celular); lee `v_productor_estado_hoy` |
| B5 | Alta de productor en campo | Crear productor de ruta sin internet (nace no aprobado). Solo exige nombre y ruta: el `tipo` lo fija la API por el rol y el "no aprobado" lo pone un trigger. DNI y celular son opcionales, pero si se escriben se validan con los CHECK de la base (8 u 11 dígitos; 9 dígitos) para no mandar un alta que el servidor va a rechazar. **No pide GPS**: `ProductorPush` no acepta `latitud_ref`, que la fija la primera recolección con buen GPS. Si el nombre o el DNI ya está en el celular se avisa, sin impedir el alta: con DNI repetido (UNIQUE) el botón principal es "usar ese productor". Al guardar se abre B4 con él. | escribe `productor` (`uuid_cliente`, `creado_por`) |
| B6 | Mi día | Recolecciones del día en hora de Lima: lo que el servidor ya recibió (`GET /acopiador/mi-dia`) más lo pendiente de Room, ordenado por hora, con litros totales y número de entregas. Las anuladas ("Anulada") y las rechazadas ("Rechazada: motivo") se ven pero NO suman; la alterada se marca y sí suma. Lo pendiente lleva "Sin enviar" y, si hay, bajo el total va "Incluye N sin enviar" (ámbar). Lo pendiente que el servidor ya tiene (respuesta del envío perdida) se descarta por UUID: no suma dos veces. Sin red se avisa que el total es solo el de este celular. Botón **"Ver días anteriores ›"** → B6b. La misma pantalla, titulada "Día anterior", muestra el detalle de un día de B6b: sin red no lleva total y solo muestra lo sin enviar y lo rechazado de ese día. | lee `recoleccion` (filtrada por `registrado_por` y fecha) |
| B6b | Últimos días | Hoy y los 6 días anteriores (`GET /acopiador/ultimos-dias`, una sola llamada), hoy arriba y resaltado. Por día: "142.00 L · 8 entregas" o "Sin entregas", más las marcas de Room "N sin enviar" (ámbar) y "N rechazada(s)" (rojo). Tocar "Hoy" abre B6; otro día, su detalle. **Sin red** no se inventan totales: los días anteriores dicen "Sin conexión" (hoy conserva el del celular), con un aviso arriba, y las marcas de lo pendiente siguen a la vista. Solo lectura: nunca bloquea el registro. Atrás: día anterior → B6b → B6 → B3. | lee `v_recoleccion_detalle` (filtrada por `registrado_por` y `fecha` de los últimos 7 días) |
| B7 | Sincronización | **Titular**: "N entregas y M productores sin enviar" (rojo) si queda cola; si no, "Enviado, con N rechazada(s)" (ámbar) mientras haya rechazos sin avisar, y solo entonces "Todo enviado". Última sincronización y "Sincronizar ahora" (llamada directa, para ver el resultado en el momento; si falla por red se encola el reintento). **Resumen** de esa sincronización sin ambigüedad: "1 productor enviado", "1 alta de productor rechazada", "1 entrega rechazada" (un alta rechazada nunca cuenta como enviada); con rechazos se muestra como error y sin "✓". **Rechazos**: cada alta rechazada en su tarjeta, con su motivo y, dentro, la leche que se le registró (hora · litros · nombre): esa leche ya se recibió y no se puede reasignar desde el celular (pendiente (H) en `docs/sincronizacion.md`); las entregas rechazadas por motivo propio, aparte. Cada tarjeta dice "Avise al administrador: dígale el nombre y este motivo." y tiene **"Ya avisé"**, que solo guarda la marca en `meta` (`avisos_vistos`): no borra ni cambia nada en Room, la leche sigue guardada (la purga solo borra lo sincronizado) y se puede ver en "Ver las ya avisadas (N)". Lo avisado deja de contar en el titular y en la pastilla de B3. Al pie, "Versión · build · commit" con `+` si el APK se armó con cambios sin commitear. | `productor`, `recoleccion` (`ON CONFLICT DO NOTHING`), pull por `actualizado_en` |

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
- **Historial de días anteriores ("Últimos días", B6b)** → `GET /acopiador/ultimos-dias` (Bloque 7, app 0.7.0).
  Diseño y decisiones en `docs/pendientes-historial.md`.
- **Por revisar del analista (C3)** → el pull envía `v_recoleccion_sin_revisar` completa y `recolecciones_hoy`
  incremental leyendo `recoleccion.actualizado_en` (Fase 2, ver `docs/sincronizacion.md`).

### Pendientes (no bloquean; se revisan en la fase indicada)
0. **Antes de entregar celulares**: límites de la rehidratación de B3 (y que B3 cuente las anuladas, (K)),
   hora automática del celular, la leche de un alta rechazada, el DNI repetido de externos que el celular
   no conoce, el borrado silencioso del pull (L) y el aviso "Sin señal" que no se apaga (M). (PIN triviales, PIN repetido, PIN inicial del admin y PIN
   de 4 dígitos: resueltos en el Bloque 6. Usuario pendiente de activar: resuelto para usuarios nuevos en
   el Bloque W1, los del seed siguen igual.)
   Lista completa en `docs/sincronizacion.md`, sección "Pendientes antes de producción".
1. **Observaciones del esquema** (Fase 2): el acopiador puede registrar productores de rutas que no son suyas.
   (Anular una recolección ya liquidada: resuelto por el parche 001.) Detalle en `docs/sincronizacion.md`.
2. **`productor`** (tabla): el mapa solo lista `v_productor_resumen`, pero Proveedores (A4) escribe en `productor`.
3. **`v_recoleccion_pago`**: no figura en el mapa; la usa Pagos (A11) para elegir qué recolecciones entran a la liquidación.
4. **Funciones internas** (`fn_precio_leche`, `fn_en_sancion`, `fn_leche_disponible`, `fn_saldo_lote`,
   `fn_costo_litro_jornada`, `fn_distancia_m`, `fn_lote_abierto`): las usan triggers y vistas; ninguna pantalla las
   necesita. `fn_leche_disponible` y `fn_saldo_lote` pueden servir para validar en el formulario antes de guardar.
5. **Panel web (Bloque W1)**, decisiones y límites conocidos:
   - **El tipo de productor no se edita.** `fn_validar_recoleccion` exige `de_ruta` al acopiador y `externo`
     al analista: cambiarlo haría rechazar en el push la leche que los celulares tengan sin enviar. Si el tipo
     está mal, se desactiva y se crea otro. (El `PATCH` del backend sí lo acepta.)
   - **Altas de campo duplicadas:** no hay fusión ni "rechazar alta"; solo se desactivan, y su leche sigue
     retenida por "no aprobado". Se suma a (H) e (I) de `docs/sincronizacion.md`.
   - **Ruta inactiva en "Rutas vigentes" del acopiador:** `SELECT_ACOPIADOR` (`backend/app/routers/usuarios.py`)
     no filtra `r.activa` y `RutaVigente` no trae ese dato, así que el detalle del acopiador muestra como
     vigente una ruta inactiva que su celular no ve (el pull sí filtra `r.activa`). Arreglarlo es un cambio de
     backend.
   - **Quién revisó una alerta y quién anuló una recolección (y por qué):** el backend no lo devuelve. Propuesta
     en `docs/pendiente-parche-002.md`.
   - **Despliegue:** `frame-ancestors` solo vale como cabecera HTTP (ver `web/README.md`), y la nota de
     `legacy-peer-deps` en `web/.npmrc`.
   - **Verificaciones con el celular pendientes:** las 4 del ciclo de activación del paso 4 (`web/README.md`).
6. **Panel web (W2)**, decisiones y límites conocidos:
   - **El admin hace de analista** en Calidad mientras no exista la app del analista: la base acepta al admin en
     `calidad_por` y la revisión reutiliza la lógica de `/sync/calidad`. Es una decisión de negocio para la
     entrega; la app del analista la reemplaza.
   - **Pagos (parche 003, `docs/pendiente-parche-003.md`):** el gasto del pago mensual del acopiador lo crea el
     backend porque falta el trigger que anuncia `schema.sql:1458`; la base **deja borrar una liquidación pagada**
     (el CASCADE esquiva `fn_proteger_liquidacion_pagada`) y no protege un pago de acopiador pagado. Hasta el
     parche, el backend lo impide.
   - **Liquidar el mismo periodo dos veces:** una entrega revisada después de liquidar su periodo no puede entrar
     en otra liquidación de ese mismo periodo para ese productor (UNIQUE de la base): se paga en otro periodo. La
     vista previa lo avisa.
   - **Corte semanal:** dato pendiente del cliente. "Liquidar periodo" propone la semana anterior de lunes a
     domingo, editable.
   - **Pérdidas del resultado:** `v_resultado_mensual` cuenta como pérdida de leche lo pagado en días sin ninguna
     leche aprobada, incluidos los días cuya leche aún no se revisó. El Dashboard lo aclara.
   - **Gastos:** "Sueldo acopiador" solo lo crea el pago mensual (el backend rechaza registrarlo a mano, para no
     contarlo dos veces). Sin editar ni eliminar.
   - **Configuración:** un precio de la leche nuevo cambia también el monto de lo aún no liquidado desde su fecha
     (lo liquidado queda congelado) y el historial no se edita ni se borra. `empresa_nombre` encabeza el comprobante impreso de la liquidación.
   - **Comprobante de liquidación:** se imprime con el navegador; un PDF necesita ReportLab (paquete nuevo).
   - **"Alcanza para" en lugar de "por reponer":** la base no tiene stock mínimo por insumo, así que Almacén y Recetas
     muestran cuánta leche cubre el stock de hoy (calculado en la web, redondeado hacia abajo).
   - **Compras de insumos:** van al flujo de caja del mes de su fecha (`v_flujo_mensual`, "Insumos"); al resultado
     (`v_resultado_mensual`) entran solo como costo de lo vendido, por diseño de la base. Una compra no se borra ni
     se edita desde el panel; la unidad de un insumo no se cambia después de crearlo.
   - **Rarezas de `fn_movimiento_insumo` al comprar:** recalcula el costo del insumo *antes* de los CHECK del
     movimiento, así que una cantidad 0 da división por cero y un costo negativo choca con el CHECK de `insumo`.
     El backend traduce ambos a 409 con el mensaje de la regla (`ck_mov_signo`, costo no negativo); la web además
     exige cantidad y costo mayores que cero.
   - **Merma de leche:** solo de leche aprobada sin lote ni merma (`fn_merma_leche`); la leche por revisar o
     descartada no se merma. Su pérdida (litros × costo por litro útil de la jornada) entra al resultado del mes de la
     jornada y **no queda congelada**: cambia si después se aprueba más leche de ese día. No cambia el flujo. La base
     no exige rol (`registrado_por` es cualquier usuario); el backend la deja solo al admin. Sin borrar desde el panel.
   - **Movimientos y Dashboard:** las sumas por tipo coinciden con `v_flujo_mensual` (ingresos, insumos, lotes,
     operativos) y `v_resultado_mensual` (bajas; mermas). No coinciden, a propósito: los **pagos a productores**
     (Movimientos los muestra cuando se pagó la liquidación; el flujo cuenta la leche en la fecha de entrega) y la
     **pérdida de leche** del resultado, que además suma lo pagado en jornadas sin leche aprobada (no es un movimiento).
     La pantalla lo dice. La consulta vive en el backend (`routers/movimientos.py`), sin vista nueva en `db/`.
   - **Código de lote:** `lote_produccion.codigo` (L-AAAA-NNNN) lo genera el backend (`routers/produccion.py`, con un
     candado por año); pendiente: una secuencia o un valor por defecto en la base.
7. **Siguiente fase (después de la entrega del Bloque W2):**
   - **Stock mínimo por insumo:** agregar `stock_minimo` a `insumo` en `db/` para marcar "por reponer" (con
     aprobación y `escenarios.sql`).
   - **Leche de varias jornadas en un lote:** la base ya lo permite (`lote_leche`, una fila por jornada, cada una con
     su costo por litro útil); falta que el backend reparta los litros desde la jornada más antigua y que la vista
     previa muestre de qué jornadas sale la leche (unas 2 a 2.5 h). Hoy Producción toma una sola jornada.
   - **Producción y ventas completas:** Insumos (A7: ajustes e historial de movimientos; "por reponer" necesita un `stock_minimo`
     por insumo, que la base no tiene), Recetas (A8), lotes por etapas con leche de varias jornadas (A9; `lote_leche`
     ya lo permite) y ventas de varias líneas y bajas (A10). La versión rápida de W2 ya usa las reglas de la base.
   - **App del analista** (mobile, C1–C3): reemplaza la revisión de calidad del admin.
   - **Mapa** (Leaflet) en Recolecciones y **Historial de cambios** (A13b, tabla `auditoria`).
   - **Calidad:** sanciones manuales y productores observados.
   - **Parches 002 y 003** (`docs/pendiente-parche-00*.md`) y la app 0.7.1 con (K), (L) y (M) de
     `docs/sincronizacion.md`.
8. **Preguntas para el cliente** (datos pendientes; hoy son valores de ejemplo):
   - **Quesos: ¿se venden por unidad o por kilo?** Las recetas de queso tienen `unidad_venta = 'unidad'`, con su
     rendimiento en unidades por 100 L y su precio por unidad. Si se venden por peso, cambian la unidad, el
     rendimiento y el precio de cada receta.
   - **Yogurt: ¿se mide en litros?** La base solo admite `'unidad'` y `'kilo'` (`unidad_venta`), y el yogurt está en
     kilos. Si se vende o controla en litros, haría falta agregar `'litro'` al tipo en `db/` (con aprobación) o
     convertir litros a kilos con la densidad.
