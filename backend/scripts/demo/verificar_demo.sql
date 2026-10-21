-- Verificación de los datos de demostración, solo con las vistas y en solo lectura.
-- Uso (desde la raíz, con las variables PG* cargadas):
--   $env:PGOPTIONS='-c default_transaction_read_only=on'; psql -d queseria -X -f backend\scripts\demo\verificar_demo.sql
\pset pager off

\echo '== Hoy en Lima'
SELECT (now() AT TIME ZONE 'America/Lima')::date AS hoy;

\echo '== Productores observados (hoy: Cirilo en sanción de precio; Gregoria bloqueada)'
SELECT nombre, ruta, acopiador, tipo_sancion, estado, sancion_desde, sancion_hasta, ph, densidad, antibioticos_positivo
  FROM v_productor_observado ORDER BY nombre;

\echo '== Ruta 2: cobertura de Rosa Elena y devuelta a Juan Carlos'
SELECT r.nombre AS ruta, u.nombre_completo AS acopiador, ra.vigente_desde, ra.vigente_hasta
  FROM ruta_acopiador ra JOIN ruta r ON r.id = ra.ruta_id JOIN usuario u ON u.id = ra.acopiador_id
 ORDER BY r.nombre, ra.vigente_desde, ra.id;

\echo '== Celulares activos (Juan Carlos conserva su Realme)'
SELECT u.nombre_completo, d.id AS dispositivo, d.modelo, d.activado_en::date
  FROM dispositivo d JOIN usuario u ON u.id = d.usuario_id WHERE d.activo ORDER BY u.id;

\echo '== Entregas por día y por quién las registró'
SELECT fecha, registrado_por_nombre, COUNT(*) AS entregas, SUM(litros) AS litros,
       COUNT(*) FILTER (WHERE anulada_en IS NOT NULL) AS anuladas
  FROM v_recoleccion_detalle GROUP BY 1, 2 ORDER BY 1, 2;

\echo '== Alertas pendientes'
SELECT a.tipo, d.fecha, d.productor, d.registrado_por_nombre, a.detalle
  FROM alerta_recoleccion a JOIN v_recoleccion_detalle d ON d.recoleccion_id = a.recoleccion_id
 WHERE a.revisada_en IS NULL ORDER BY a.tipo, d.fecha;

\echo '== Entregas anuladas'
SELECT d.fecha, d.productor, d.litros, r.motivo_anulacion
  FROM v_recoleccion_detalle d JOIN recoleccion r ON r.id = d.recoleccion_id
 WHERE d.anulada_en IS NOT NULL ORDER BY d.fecha;

\echo '== Calidad: por revisar'
SELECT productor, litros, registrada_en AT TIME ZONE 'America/Lima' AS hora FROM v_recoleccion_sin_revisar ORDER BY registrada_en;

\echo '== Leche por jornada (hoy no debe quedar nada "sin destino")'
SELECT fecha, litros_recolectados, litros_descartados, litros_por_revisar, litros_aprobados, litros_usados, litros_merma,
       litros_disponibles, costo_litro_util, sin_destino
  FROM v_leche_jornada ORDER BY fecha;

\echo '== Lotes'
SELECT codigo, receta, fecha_produccion, estado, litros_leche, cantidad_producida, cantidad_vendida, cantidad_baja, saldo,
       ingresos, costo_total, utilidad_realizada
  FROM v_lote_resumen ORDER BY fecha_produccion, codigo;

\echo '== Ventas por cliente'
SELECT c.nombre AS cliente, COUNT(*) AS ventas, SUM(d.subtotal) AS total
  FROM venta v JOIN cliente c ON c.id = v.cliente_id JOIN venta_detalle d ON d.venta_id = v.id
 GROUP BY 1 ORDER BY 1;

\echo '== Liquidaciones'
SELECT productor, desde, hasta, estado, n_recolecciones, litros, monto, litros_con_sancion, descuento_sancion
  FROM v_liquidacion_productor ORDER BY estado, desde, productor;

\echo '== Por pagar (incluye lo retenido: alta de campo pendiente)'
SELECT nombre, litros_pagables, monto_pagable, monto_en_espera FROM v_pago_pendiente_productor ORDER BY nombre;
SELECT p.nombre, p.aprobado, pg.fecha, pg.litros, pg.revisada, pg.retenida, pg.monto
  FROM v_recoleccion_pago pg JOIN productor p ON p.id = pg.productor_id WHERE pg.retenida;

\echo '== Acopiadores del mes y sueldo pagado'
SELECT nombre_completo, mes, litros, litros_normales, sueldo_estimado FROM v_acopiador_mes ORDER BY mes, nombre_completo;
SELECT u.nombre_completo, pa.mes, pa.total, pa.estado, pa.pagado_en::date FROM pago_acopiador pa JOIN usuario u ON u.id = pa.acopiador_id;

\echo '== Gastos, mermas, bajas e insumos'
SELECT g.fecha, c.nombre AS categoria, g.descripcion, g.monto FROM gasto_operativo g JOIN categoria_gasto c ON c.id = g.categoria_id ORDER BY g.fecha;
SELECT fecha, litros, motivo FROM merma_leche;
SELECT l.codigo, b.cantidad, b.motivo, b.nota FROM baja_producto b JOIN lote_produccion l ON l.id = b.lote_id;
SELECT nombre, unidad, stock, costo_unitario FROM v_insumo_stock ORDER BY nombre;

\echo '== Productores: alta de campo pendiente y externos'
SELECT codigo, nombre, tipo, pendiente_aprobacion, n_recolecciones, litros_total, sancionado, bloqueado
  FROM v_productor_resumen WHERE pendiente_aprobacion OR tipo = 'externo' ORDER BY nombre;

\echo '== Dinero del mes'
SELECT * FROM v_flujo_mensual ORDER BY mes;
SELECT * FROM v_resultado_mensual ORDER BY mes;
SELECT * FROM v_leche_stock;
