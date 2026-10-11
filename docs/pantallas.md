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
| A3 | Mapa / Recolecciones | Lista y mapa (Leaflet) de recolecciones con color del acopiador, calidad, ubicación, alertas y estado de pago. Revisar alertas (marcar revisada + resolución, libera pagos retenidos). Anular una recolección con motivo. | lee `v_recoleccion_detalle`, `alerta_recoleccion`; escribe `alerta_recoleccion` (`revisada_*`, `resolucion`), `recoleccion` (`anulada_*`, `motivo_anulacion`) |
| A4 | Proveedores | Lista de productores (de ruta y externos) con litros, descartes, estado de sanción y pendientes de aprobación. Crear/editar productor, aprobar altas de campo, ver su historial de recolecciones. | lee `v_productor_resumen`, `v_recoleccion_detalle`; escribe `productor` (incl. `aprobado`) |
| A5 | Acopiadores | Datos del acopiador (color, vehículo, sueldo base, comisión), rutas asignadas con historial, sueldo estimado del mes y registro del pago mensual. | lee/escribe `acopiador`, `ruta_acopiador`, `pago_acopiador`; lee `v_acopiador_mes` |
| A6 | Control de calidad | Recolecciones sin revisar, estado de productores hoy, % de alteradas por analista, sanciones (crear a mano o levantar). | lee `v_recoleccion_sin_revisar`, `v_productor_estado_hoy`, `v_analista_resumen`; lee/escribe `sancion_productor` |
| A7 | Insumos | Stock y costo promedio por insumo; registrar ingresos (compras) y ajustes; historial de movimientos. | lee `v_insumo_stock`; lee/escribe `insumo`, `movimiento_insumo` |
| A8 | Recetas | Las 4 recetas: precio, rendimiento por 100 L, vida útil e insumos por 100 L. | lee/escribe `receta`, `receta_insumo` |
| A9 | Producción (lotes) | Crear lote, asignar leche de jornadas (a costo por litro útil), consumir insumos, registrar costos propios, cerrar con cantidad producida; hoja de costos y rendimiento real vs. teórico. | lee `v_leche_jornada`, `v_lote_resumen`, `receta`, `receta_insumo`; escribe `lote_produccion`, `lote_leche`, `lote_costo`, `movimiento_insumo` (`consumo_lote`) |
| A10 | Ventas | Venta al contado a un cliente desde lotes con saldo (el que vence primero arriba); bajas de producto (merma, vencido, muestra); clientes. | lee `v_lote_disponible`; lee/escribe `cliente`, `venta`, `venta_detalle`, `baja_producto` |
| A11 | Pagos a productores | Cuentas por pagar (pagable y en espera); generar liquidación semanal, marcarla pagada, comprobante PDF. | lee `v_pago_pendiente_productor`, `v_liquidacion_productor`; escribe `liquidacion_productor`, `liquidacion_detalle` |
| A12 | Gastos | Gastos operativos por categoría (opcionalmente por acopiador). | lee/escribe `gasto_operativo`; lee `categoria_gasto` |
| A13 | Configuración | Parámetros (sanción, GPS, alertas…), historial de precios de leche, usuarios, celulares vinculados y códigos de activación. | lee/escribe `configuracion`, `precio_leche`, `usuario`, `dispositivo`, `codigo_activacion` |

---

## (b) App del acopiador (móvil, offline)

| # | Pantalla | Qué muestra / permite | Objetos de la base |
|---|----------|-----------------------|--------------------|
| B1 | Vincular celular | Ingresar el código que generó el admin (una sola vez); registra el dispositivo y su clave pública. | lee/escribe `codigo_activacion` (`usado_en`); escribe `dispositivo` |
| B2 | Ingreso con PIN | Teclado con dígitos mezclados; bloqueo tras intentos fallidos; cambiar PIN. | lee/escribe `usuario` (`pin_hash`, `pin_intentos_fallidos`, `bloqueado_hasta`, `pin_actualizado_en`) |
| B3 | Mis productores | Productores de SUS rutas vigentes; nombre en rojo si está sancionado o bloqueado. | lee `productor`, `ruta`, `ruta_acopiador`, `v_productor_estado_hoy` (pull por `actualizado_en`) |
| B4 | Registrar recolección | Litros + observación; GPS, precisión, ubicación simulada, hora GPS, hora automática, firma y `hash_anterior`. Se guarda sin GPS (`origen_ubicacion='ninguna'`). | escribe `recoleccion` (UUID del celular) |
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

### Pantallas sin objeto (o con objeto incompleto) en la base
1. **Mi día del acopiador (B6)**: no hay vista de resumen por acopiador y día; hoy se leería `recoleccion` directo. En el móvil se puede calcular con los datos locales de Room, así que no es bloqueante.
2. **Por revisar del analista (C3)**: `v_recoleccion_sin_revisar` no expone `actualizado_en`, `ruta_id` ni `estado_calidad`. Para un pull incremental se tendría que leer `recoleccion`.
3. **App del acopiador frente al productor bloqueado (B3)**: el comentario de `v_productor_estado_hoy` dice "impedir el registro del productor bloqueado". Pero `CLAUDE.md` y el trigger `fn_alertas_recoleccion` dicen que se registra y se retiene el pago. Hay que confirmar cuál de las dos reglas sigue la app; la propuesta es solo advertir y no impedir.

### Objetos que no usa ninguna pantalla del mapa
1. **`merma_leche`**: el dashboard muestra `litros_sin_destino` ("hay que registrar su merma"), pero el mapa no le da pantalla. La propuesta es registrar la merma en Producción (A9).
2. **`ruta`**: el mapa solo lista `ruta_acopiador`. Falta dónde crear, editar o desactivar rutas. La propuesta es una sección "Rutas" dentro de Acopiadores (A5).
3. **`auditoria`**: ninguna pantalla la consulta. Se propone una vista "Historial de cambios" en Configuración (A13).
4. **`analisis_calidad`**: el admin solo la ve a través de `v_productor_observado`. No hay forma de ver el análisis de cualquier recolección alterada desde Recolecciones (A3), salvo leyendo la tabla directamente.
5. **`liquidacion_detalle`** y **`v_recoleccion_pago`**: no figuran en el mapa. Se usan en Pagos (A11) para armar la liquidación (qué recolecciones incluye) y en el comprobante.
6. **`productor`** (tabla): el mapa solo lista `v_productor_resumen`, pero Proveedores (A4) necesita escribir en `productor`, por ejemplo para aprobar.
7. **Funciones internas** (`fn_precio_leche`, `fn_en_sancion`, `fn_leche_disponible`, `fn_saldo_lote`, `fn_costo_litro_jornada`, `fn_distancia_m`, `fn_lote_abierto`): las usan triggers y vistas; ninguna pantalla las necesita directamente. `fn_leche_disponible` y `fn_saldo_lote` podrían servir para validar en el formulario antes de guardar, aunque la base valida de todos modos.
