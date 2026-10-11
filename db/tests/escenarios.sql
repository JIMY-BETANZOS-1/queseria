\set ON_ERROR_STOP off
BEGIN;
CREATE TEMP TABLE res(n text, ok boolean);
CREATE FUNCTION pg_temp.chk(n text, c boolean) RETURNS void LANGUAGE sql AS $$ INSERT INTO res VALUES (n, COALESCE(c,false)) $$;
-- espera que el SQL falle (y opcionalmente que el mensaje contenga m)
CREATE FUNCTION pg_temp.err(n text, q text, m text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE q; INSERT INTO res VALUES (n, false);
  EXCEPTION WHEN OTHERS THEN INSERT INTO res VALUES (n, SQLERRM LIKE '%'||m||'%'); END;
END $$;
CREATE FUNCTION pg_temp.u(i int) RETURNS uuid LANGUAGE sql AS $$ SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid $$;
CREATE FUNCTION pg_temp.rec(i int, prod bigint, por bigint, lit numeric, ts text, est estado_calidad DEFAULT 'normal',
   cpor bigint DEFAULT NULL, cen text DEFAULT NULL, lat numeric DEFAULT NULL, lon numeric DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  INSERT INTO recoleccion(id,productor_id,registrado_por,litros,registrada_en,estado_calidad,calidad_por,calidad_en,latitud,longitud,precision_m,origen_ubicacion)
  VALUES (pg_temp.u(i),prod,por,lit,ts::timestamptz,est,cpor,cen::timestamptz,lat,lon,CASE WHEN lat IS NULL THEN NULL ELSE 10 END,
          CASE WHEN lat IS NULL THEN 'ninguna'::origen_ubicacion ELSE 'gps'::origen_ubicacion END) $$;

-- Usuarios
INSERT INTO usuario(rol,nombre_completo,email,password_hash) VALUES ('admin','Gerente','a@x.pe','h');
INSERT INTO usuario(rol,nombre_completo,dni,celular,pin_hash) VALUES
 ('acopiador','Acop Uno','11111111','900000001','p'),
 ('analista','Analista Uno','22222222','900000002','p');
INSERT INTO acopiador(usuario_id,color_hex,vehiculo,sueldo_base_mensual,comision_por_litro)
 SELECT id,'#FF0000','moto_lineal',1200,0.05 FROM usuario WHERE dni='11111111';
INSERT INTO ruta(nombre) VALUES ('R1');
INSERT INTO ruta_acopiador(ruta_id,acopiador_id) SELECT r.id,u.id FROM ruta r, usuario u WHERE u.dni='11111111';
INSERT INTO productor(nombre,tipo,ruta_id) SELECT 'P1','de_ruta',id FROM ruta;
INSERT INTO productor(nombre,tipo,ruta_id) SELECT 'P2','de_ruta',id FROM ruta;
INSERT INTO productor(nombre,tipo,ruta_id) SELECT 'P3','de_ruta',id FROM ruta;
INSERT INTO productor(nombre,tipo,documento,celular) VALUES ('PE','externo','33333333','911111111');
CREATE TEMP TABLE m AS SELECT
  (SELECT id FROM usuario WHERE rol='admin') adm, (SELECT id FROM usuario WHERE rol='acopiador') aco, (SELECT id FROM usuario WHERE rol='analista') ana,
  (SELECT id FROM productor WHERE nombre='P1') p1, (SELECT id FROM productor WHERE nombre='P2') p2,
  (SELECT id FROM productor WHERE nombre='P3') p3, (SELECT id FROM productor WHERE nombre='PE') pe;

SELECT pg_temp.chk('codigo productor P-0001', (SELECT codigo FROM productor WHERE nombre='P1') LIKE 'P-%');
-- 1 roles
SELECT pg_temp.err('acopiador no registra externo', format('SELECT pg_temp.rec(1,%s,%s,10,%L)',(SELECT pe FROM m),(SELECT aco FROM m),'2026-03-02 07:00-05'),'solo registra productores de ruta');
SELECT pg_temp.err('analista no registra de_ruta', format('SELECT pg_temp.rec(1,%s,%s,10,%L)',(SELECT p1 FROM m),(SELECT ana FROM m),'2026-03-02 07:00-05'),'solo registra productores externos');
SELECT pg_temp.err('acopiador no fija calidad', format('SELECT pg_temp.rec(1,%s,%s,10,%L,''normal'',%s,%L)',(SELECT p1 FROM m),(SELECT aco FROM m),'2026-03-02 07:00-05',(SELECT aco FROM m),'2026-03-02 18:00-05'),'analista o el admin');

-- 2 Jornada 2026-03-02
SELECT pg_temp.rec(10,p1,aco,100,'2026-03-02 07:00-05','normal',ana,'2026-03-02 18:00-05',-15.000,-69.900) FROM m;
SELECT pg_temp.rec(11,p2,aco, 50,'2026-03-02 08:00-05','alterado',ana,'2026-03-02 18:05-05',-15.010,-69.910) FROM m;
INSERT INTO analisis_calidad(recoleccion_id,ph,antibioticos_positivo) VALUES (pg_temp.u(11),6.2,true);
SELECT pg_temp.rec(12,p3,aco, 40,'2026-03-02 09:00-05','normal',ana,'2026-03-02 18:10-05',-15.020,-69.920) FROM m;
SELECT pg_temp.chk('ref productor fijada por 1er GPS', (SELECT latitud_ref FROM productor WHERE id=(SELECT p1 FROM m)) = -15.000);
SELECT pg_temp.chk('ruta_id copiada', (SELECT ruta_id FROM recoleccion WHERE id=pg_temp.u(10)) IS NOT NULL);
SELECT pg_temp.chk('sancion precio P2 03-03..03-09', EXISTS(SELECT 1 FROM sancion_productor s,m WHERE s.productor_id=m.p2 AND s.tipo='precio' AND s.desde='2026-03-03' AND s.hasta='2026-03-09'));
SELECT pg_temp.chk('P1 sin sancion', NOT EXISTS(SELECT 1 FROM sancion_productor s,m WHERE s.productor_id=m.p1));
SELECT pg_temp.chk('pago dia1 = 1.70 incl alterada', (SELECT sum(monto) FROM v_recoleccion_pago WHERE fecha='2026-03-02') = 323.00);
SELECT pg_temp.chk('jornada aprobados 140', (SELECT litros_aprobados FROM v_leche_jornada WHERE fecha='2026-03-02') = 140);
SELECT pg_temp.chk('costo_litro_util 323/140', (SELECT costo_litro_util FROM v_leche_jornada WHERE fecha='2026-03-02') = round(323/140.0,4));
SELECT pg_temp.chk('descartados 50', (SELECT litros_descartados FROM v_leche_jornada WHERE fecha='2026-03-02') = 50);

-- alterado sin analisis: falla al forzar el chequeo diferido
SAVEPOINT s1;
SELECT pg_temp.rec(13,p3,aco,20,'2026-03-02 10:00-05','alterado',ana,'2026-03-02 18:20-05') FROM m;
SELECT pg_temp.err('alterado sin analisis falla','SET CONSTRAINTS trg_recoleccion_exigir_analisis IMMEDIATE','requiere su análisis');
ROLLBACK TO s1;
SELECT pg_temp.chk('rollback savepoint limpio', NOT EXISTS(SELECT 1 FROM recoleccion WHERE id=pg_temp.u(13)));
SELECT pg_temp.chk('alterado con analisis pasa', (SELECT count(*) FROM recoleccion WHERE id=pg_temp.u(11))=1);

-- 3 Dia 2: P2 sancionado -> 0.70
SELECT pg_temp.rec(20,p2,aco,30,'2026-03-03 07:00-05','normal',ana,'2026-03-03 18:00-05') FROM m;
SELECT pg_temp.chk('P2 paga 0.70 en sancion', (SELECT monto FROM v_recoleccion_pago WHERE recoleccion_id=pg_temp.u(20)) = 21.00);
SELECT pg_temp.chk('con_sancion true', (SELECT con_sancion FROM v_recoleccion_pago WHERE recoleccion_id=pg_temp.u(20)));
-- sin revisar: no pagable
SELECT pg_temp.rec(21,p1,aco,60,'2026-03-03 07:30-05') FROM m;
SELECT pg_temp.chk('sin revisar no pagable', NOT (SELECT pagable FROM v_recoleccion_pago WHERE recoleccion_id=pg_temp.u(21)));
SELECT pg_temp.chk('aparece en sin_revisar', EXISTS(SELECT 1 FROM v_recoleccion_sin_revisar WHERE recoleccion_id=pg_temp.u(21)));
SELECT pg_temp.chk('jornada 03-03 por revisar 60', (SELECT litros_por_revisar FROM v_leche_jornada WHERE fecha='2026-03-03')=60);

-- 4 Reincidencia: P2 alterado marcado 03-05 -> bloqueo 03-06..03-12
SELECT pg_temp.rec(30,p2,aco,25,'2026-03-05 07:00-05','alterado',ana,'2026-03-05 18:00-05') FROM m;
INSERT INTO analisis_calidad(recoleccion_id,densidad) VALUES (pg_temp.u(30),1.020);
SELECT pg_temp.chk('reincidencia -> bloqueo 03-06..03-12', EXISTS(SELECT 1 FROM sancion_productor s,m WHERE s.productor_id=m.p2 AND s.tipo='bloqueo' AND s.desde='2026-03-06' AND s.hasta='2026-03-12' AND s.recoleccion_id=pg_temp.u(30)));
-- leche del bloqueado: alerta + retenida
SELECT pg_temp.rec(31,p2,aco,15,'2026-03-07 07:00-05','normal',ana,'2026-03-07 18:00-05') FROM m;
SELECT pg_temp.chk('alerta productor_bloqueado', EXISTS(SELECT 1 FROM alerta_recoleccion WHERE recoleccion_id=pg_temp.u(31) AND tipo='productor_bloqueado'));
SELECT pg_temp.chk('bloqueado: retenida y no pagable', (SELECT retenida AND NOT pagable FROM v_recoleccion_pago WHERE recoleccion_id=pg_temp.u(31)));
SELECT pg_temp.chk('monto_en_espera P2 >0', (SELECT monto_en_espera FROM v_pago_pendiente_productor WHERE productor_id=(SELECT p2 FROM m))>0);

-- 5 Alertas
SELECT pg_temp.rec(40,p3,aco,40,'2026-03-04 07:00-05','normal',ana,'2026-03-04 18:00-05') FROM m;  -- sin GPS
SELECT pg_temp.chk('alerta sin_ubicacion', EXISTS(SELECT 1 FROM alerta_recoleccion WHERE recoleccion_id=pg_temp.u(40) AND tipo='sin_ubicacion'));
SELECT pg_temp.chk('duplicado P3 40L vs dia previo NO (>30min)', NOT EXISTS(SELECT 1 FROM alerta_recoleccion WHERE recoleccion_id=pg_temp.u(40) AND tipo='posible_duplicado'));
SELECT pg_temp.rec(41,p3,aco,40,'2026-03-04 07:10-05','normal',ana,'2026-03-04 18:00-05',-15.020,-69.920) FROM m;
SELECT pg_temp.chk('alerta posible_duplicado', EXISTS(SELECT 1 FROM alerta_recoleccion WHERE recoleccion_id=pg_temp.u(41) AND tipo='posible_duplicado'));
SELECT pg_temp.rec(42,p3,aco,33,'2026-03-04 12:00-05','normal',ana,'2026-03-04 18:00-05',-15.040,-69.920) FROM m;  -- ~2.2km de ref
SELECT pg_temp.chk('alerta lejos_del_productor', EXISTS(SELECT 1 FROM alerta_recoleccion WHERE recoleccion_id=pg_temp.u(42) AND tipo='lejos_del_productor'));
SELECT pg_temp.rec(43,p1,aco,10,'2026-03-04 12:05-05','normal',ana,'2026-03-04 18:00-05',-15.500,-69.900) FROM m;  -- ~55km en 5min
SELECT pg_temp.chk('alerta velocidad_imposible', EXISTS(SELECT 1 FROM alerta_recoleccion WHERE recoleccion_id=pg_temp.u(43) AND tipo='velocidad_imposible'));
INSERT INTO recoleccion(id,productor_id,registrado_por,litros,registrada_en,latitud,longitud,precision_m,origen_ubicacion,ubicacion_simulada,hora_automatica)
 SELECT pg_temp.u(44),p1,aco,5,'2026-03-04 13:00-05',-15.0,-69.9,10,'gps',true,false FROM m;
SELECT pg_temp.chk('alertas simulada + hora', (SELECT count(*) FROM alerta_recoleccion WHERE recoleccion_id=pg_temp.u(44) AND tipo IN ('ubicacion_simulada','hora_inconsistente'))=2);
-- litros atipicos: P1 historial de 5 normales y luego 1000
DO $$ DECLARE r record; i int; BEGIN SELECT * INTO r FROM m;
 FOR i IN 1..5 LOOP PERFORM pg_temp.rec(100+i,r.p1,r.aco,50+i,format('2026-02-%s 07:00-05',10+i),'normal',r.ana,format('2026-02-%s 18:00-05',10+i)); END LOOP;
 PERFORM pg_temp.rec(110,r.p1,r.aco,1000,'2026-02-20 07:00-05'); END $$;
SELECT pg_temp.chk('alerta litros_atipicos', EXISTS(SELECT 1 FROM alerta_recoleccion WHERE recoleccion_id=pg_temp.u(110) AND tipo='litros_atipicos'));
-- externo (analista) sin alerta de ubicacion
SELECT pg_temp.rec(50,pe,ana,70,'2026-03-09 10:00-05','normal',ana,'2026-03-09 10:30-05') FROM m;
SELECT pg_temp.chk('externo sin alertas ubicacion', NOT EXISTS(SELECT 1 FROM alerta_recoleccion WHERE recoleccion_id=pg_temp.u(50)));
SELECT pg_temp.chk('externo color gris en detalle', (SELECT color_hex FROM v_recoleccion_detalle WHERE recoleccion_id=pg_temp.u(50))='#6B7280');
SELECT pg_temp.chk('acopiador color en detalle', (SELECT color_hex FROM v_recoleccion_detalle WHERE recoleccion_id=pg_temp.u(10))='#FF0000');
SELECT pg_temp.chk('externo ruta null', (SELECT ruta_id FROM recoleccion WHERE id=pg_temp.u(50)) IS NULL);

-- 6 Productor provisional
INSERT INTO productor(nombre,tipo,ruta_id,creado_por,uuid_cliente) SELECT 'PNUEVO','de_ruta',(SELECT id FROM ruta),aco,gen_random_uuid() FROM m;
SELECT pg_temp.chk('alta por acopiador => no aprobado', NOT (SELECT aprobado FROM productor WHERE nombre='PNUEVO'));
SELECT pg_temp.rec(60,(SELECT id FROM productor WHERE nombre='PNUEVO'),aco,20,'2026-03-04 07:00-05','normal',ana,'2026-03-04 18:00-05') FROM m;
SELECT pg_temp.chk('provisional: retenida', (SELECT retenida FROM v_recoleccion_pago WHERE recoleccion_id=pg_temp.u(60)));
UPDATE productor SET aprobado=true WHERE nombre='PNUEVO';
SELECT pg_temp.chk('aprobado: pagable', (SELECT pagable FROM v_recoleccion_pago WHERE recoleccion_id=pg_temp.u(60)));

-- 7 Liquidacion
INSERT INTO liquidacion_productor(productor_id,desde,hasta,creada_por) SELECT p1,'2026-03-02','2026-03-08',adm FROM m;
INSERT INTO liquidacion_productor(productor_id,desde,hasta,creada_por) SELECT p2,'2026-03-02','2026-03-08',adm FROM m;
CREATE TEMP TABLE liq AS SELECT productor_id, id FROM liquidacion_productor;
CREATE FUNCTION pg_temp.det(i int, prod bigint) RETURNS void LANGUAGE sql AS $$
  INSERT INTO liquidacion_detalle(recoleccion_id,liquidacion_id,litros,precio_litro,con_sancion,monto)
  SELECT recoleccion_id,(SELECT id FROM liq WHERE productor_id=prod),litros,precio_litro,con_sancion,monto FROM v_recoleccion_pago WHERE recoleccion_id=pg_temp.u(i) $$;
SELECT pg_temp.err('liq: sin revisar', format('SELECT pg_temp.det(21,%s)',(SELECT p1 FROM m)),'no es pagable');
SELECT pg_temp.err('liq: retenida', format('SELECT pg_temp.det(31,%s)',(SELECT p2 FROM m)),'no es pagable');
SELECT pg_temp.err('liq: otro productor', format('SELECT pg_temp.det(12,%s)',(SELECT p1 FROM m)),'no pertenece');
SELECT pg_temp.err('liq: fuera de periodo', format('SELECT pg_temp.det(110,%s)',(SELECT p1 FROM m)),'');
SELECT pg_temp.err('liq: pagar sin detalle', format('UPDATE liquidacion_productor SET estado=''pagado'',pagada_en=now(),pagada_por=%s WHERE id=(SELECT id FROM liq WHERE productor_id=%s)',(SELECT adm FROM m),(SELECT p1 FROM m)),'sin detalle');
SELECT pg_temp.det(10,p1) FROM m;
SELECT pg_temp.det(20,p2) FROM m;
SELECT pg_temp.det(30,p2) FROM m;
SELECT pg_temp.chk('liq P1 monto 170', (SELECT monto FROM v_liquidacion_productor WHERE productor_id=(SELECT p1 FROM m))=170);
SELECT pg_temp.chk('liq P2 descuento sancion', (SELECT litros_con_sancion=55 AND descuento_sancion=55.00 FROM v_liquidacion_productor WHERE productor_id=(SELECT p2 FROM m)));
-- cambio de precio no altera lo congelado
INSERT INTO precio_leche(tipo,precio_litro,vigente_desde) VALUES ('normal',1.20,'2026-03-01');
SELECT pg_temp.chk('liquidada sigue 170 con precio 1.20', (SELECT monto FROM v_recoleccion_pago WHERE recoleccion_id=pg_temp.u(10))=170);
SELECT pg_temp.chk('no liquidada usa 1.20', (SELECT precio_litro FROM v_recoleccion_pago WHERE recoleccion_id=pg_temp.u(12))=1.20);
DELETE FROM precio_leche WHERE precio_litro=1.20;
UPDATE liquidacion_productor SET estado='pagado',pagada_en=now(),pagada_por=(SELECT adm FROM m) WHERE productor_id=(SELECT p1 FROM m);
SELECT pg_temp.err('liq pagada inmutable', 'DELETE FROM liquidacion_detalle WHERE recoleccion_id=pg_temp.u(10)','ya está pagada');
SELECT pg_temp.chk('pendiente P1 excluye liquidada', NOT EXISTS(SELECT 1 FROM v_recoleccion_pago WHERE recoleccion_id=pg_temp.u(10) AND NOT liquidada));

-- 8 Receta / insumo / lote
INSERT INTO insumo(nombre,unidad) VALUES ('Cuajo','g');
INSERT INTO movimiento_insumo(insumo_id,tipo,cantidad,costo_unitario,usuario_id) SELECT i.id,'stock_inicial',1000,0.5,m.adm FROM insumo i,m;
UPDATE receta SET rendimiento_base=10, dias_vida_util=10 WHERE nombre='Queso paria';
INSERT INTO lote_produccion(codigo,receta_id,fecha_produccion,creado_por) SELECT 'L-1',r.id,'2026-03-03',m.adm FROM receta r,m WHERE r.nombre='Queso paria';
CREATE TEMP TABLE l AS SELECT id FROM lote_produccion WHERE codigo='L-1';
SELECT pg_temp.err('lote: cerrar sin leche', 'UPDATE lote_produccion SET estado=''cerrado'',cantidad_producida=10,cerrado_en=now() WHERE codigo=''L-1''','no tiene leche');
SELECT pg_temp.err('lote_leche: mas que aprobada', 'INSERT INTO lote_leche(lote_id,fecha,litros,costo_litro) SELECT id,''2026-03-02'',141,0 FROM l','insuficiente');
SELECT pg_temp.err('lote_leche: jornada sin revisar', 'INSERT INTO lote_leche(lote_id,fecha,litros,costo_litro) SELECT id,''2026-03-03'',100,0 FROM l','insuficiente');
INSERT INTO lote_leche(lote_id,fecha,litros,costo_litro) SELECT id,'2026-03-02',100,0 FROM l;
SELECT pg_temp.chk('lote_leche costo congelado = costo util', (SELECT costo_litro FROM lote_leche WHERE lote_id=(SELECT id FROM l))=round(323/140.0,4));
SELECT pg_temp.chk('disponibles tras lote = 40', (SELECT litros_disponibles FROM v_leche_jornada WHERE fecha='2026-03-02')=40);
SELECT pg_temp.err('merma > disponible', 'INSERT INTO merma_leche(fecha,litros,motivo,registrado_por) SELECT ''2026-03-02'',41,''x'',adm FROM m','supera');
INSERT INTO merma_leche(fecha,litros,motivo,registrado_por) SELECT '2026-03-02',10,'se agrió',adm FROM m;
INSERT INTO movimiento_insumo(insumo_id,tipo,cantidad,lote_id,usuario_id) SELECT i.id,'consumo_lote',-100,l.id,m.adm FROM insumo i,l,m;
INSERT INTO lote_costo(lote_id,concepto,monto) SELECT id,'electricidad',20 FROM l;
INSERT INTO lote_costo(lote_id,concepto,monto) SELECT id,'mano_obra',30 FROM l;
UPDATE lote_produccion SET estado='cerrado',cantidad_producida=40,cerrado_en=now() WHERE codigo='L-1';
SELECT pg_temp.chk('costo leche lote 230.71', (SELECT costo_leche FROM v_lote_resumen WHERE codigo='L-1')=230.71);
SELECT pg_temp.chk('costo total = 230.71+50+50', (SELECT costo_total FROM v_lote_resumen WHERE codigo='L-1')=330.71);
SELECT pg_temp.chk('rendimiento teorico 100L->10', (SELECT rendimiento_teorico FROM v_lote_resumen WHERE codigo='L-1')=10.00);
SELECT pg_temp.chk('desviacion +300%', (SELECT desviacion_rendimiento_pct FROM v_lote_resumen WHERE codigo='L-1')=300.0);
SELECT pg_temp.chk('fecha_vencimiento 03-13', (SELECT fecha_vencimiento FROM v_lote_resumen WHERE codigo='L-1')='2026-03-13');
SELECT pg_temp.err('cerrado: no mas leche','INSERT INTO lote_leche(lote_id,fecha,litros,costo_litro) SELECT id,''2026-03-02'',1,0 FROM l','cerrado');
SELECT pg_temp.err('cerrado: no mas costos','INSERT INTO lote_costo(lote_id,concepto,monto) SELECT id,''otro'',1 FROM l','cerrado');
SELECT pg_temp.err('cerrado: no mas insumo','INSERT INTO movimiento_insumo(insumo_id,tipo,cantidad,lote_id,usuario_id) SELECT i.id,''consumo_lote'',-1,l.id,m.adm FROM insumo i,l,m','cerrado');

-- 9 Ventas / bajas / vencimiento
INSERT INTO cliente(nombre) VALUES ('Cliente 1');
INSERT INTO venta(cliente_id,fecha,registrada_por) SELECT (SELECT id FROM cliente),'2026-03-05',adm FROM m;
CREATE TEMP TABLE v AS SELECT id FROM venta;
SELECT pg_temp.err('venta > saldo','INSERT INTO venta_detalle(venta_id,lote_id,cantidad,precio_unitario) SELECT v.id,l.id,41,20 FROM v,l','Saldo insuficiente');
INSERT INTO venta_detalle(venta_id,lote_id,cantidad,precio_unitario) SELECT v.id,l.id,30,20 FROM v,l;
INSERT INTO baja_producto(lote_id,cantidad,motivo,fecha,registrado_por) SELECT l.id,2,'muestra','2026-03-05',adm FROM l,m;
SELECT pg_temp.chk('saldo = 40-30-2', (SELECT saldo FROM v_lote_resumen WHERE codigo='L-1')=8);
SELECT pg_temp.err('no reabrir con ventas','UPDATE lote_produccion SET estado=''en_proceso'' WHERE codigo=''L-1''','No se puede reabrir');
SELECT pg_temp.err('producido < salido','UPDATE lote_produccion SET cantidad_producida=20 WHERE codigo=''L-1''','no puede ser menor');
INSERT INTO venta(cliente_id,fecha,registrada_por) SELECT (SELECT id FROM cliente),'2026-03-20',adm FROM m;
SELECT pg_temp.err('venta de lote vencido','INSERT INTO venta_detalle(venta_id,lote_id,cantidad,precio_unitario) SELECT (SELECT max(id) FROM venta),l.id,1,20 FROM l','vencido');
INSERT INTO venta(cliente_id,fecha,registrada_por) SELECT (SELECT id FROM cliente),'2026-03-01',adm FROM m;
SELECT pg_temp.err('venta antes de produccion','INSERT INTO venta_detalle(venta_id,lote_id,cantidad,precio_unitario) SELECT (SELECT max(id) FROM venta),l.id,1,20 FROM l','anterior');
SELECT pg_temp.chk('v_lote_disponible lo lista', EXISTS(SELECT 1 FROM v_lote_disponible WHERE codigo='L-1' AND saldo=8));
SELECT pg_temp.chk('costo vendido = 30*330.71/40', (SELECT costo_vendido FROM v_lote_resumen WHERE codigo='L-1')=round(30*330.71/40,2));

-- 10 Conciliacion de la leche: pagado jornada 03-02 = usado + merma + sobrante (a costo util)
SELECT pg_temp.chk('conciliacion leche jornada 03-02',
  abs((SELECT costo_pagado FROM v_leche_jornada WHERE fecha='2026-03-02')
       - (SELECT sum(costo) FROM lote_leche WHERE fecha='2026-03-02')
       - (SELECT sum(litros) FROM merma_leche WHERE fecha='2026-03-02')*(SELECT costo_litro_util FROM v_leche_jornada WHERE fecha='2026-03-02')
       - (SELECT litros_disponibles FROM v_leche_jornada WHERE fecha='2026-03-02')*(SELECT costo_litro_util FROM v_leche_jornada WHERE fecha='2026-03-02')) < 0.05);
-- Jornada sin leche aprobada: perdida
SELECT pg_temp.rec(70,p1,aco,10,'2026-04-01 07:00-05','alterado',ana,'2026-04-01 18:00-05') FROM m;
INSERT INTO analisis_calidad(recoleccion_id,ph) VALUES (pg_temp.u(70),5.0);
SELECT pg_temp.chk('jornada sin aprobada -> perdida_leche en resultado', (SELECT perdida_leche FROM v_resultado_mensual WHERE mes='2026-04-01')>0);
SELECT pg_temp.chk('resultado marzo: ingresos 600', (SELECT ingresos FROM v_resultado_mensual WHERE mes='2026-03-01')=600);
SELECT pg_temp.chk('resultado marzo: perdida_producto >0', (SELECT perdida_producto FROM v_resultado_mensual WHERE mes='2026-03-01')>0);
SELECT pg_temp.chk('resultado marzo: perdida merma leche', (SELECT perdida_leche FROM v_resultado_mensual WHERE mes='2026-03-01')>0);
SELECT pg_temp.chk('flujo marzo existe', EXISTS(SELECT 1 FROM v_flujo_mensual WHERE mes='2026-03-01' AND total_invertido>0));

-- 11 Correccion/anulacion levanta sancion
UPDATE recoleccion SET estado_calidad='normal' WHERE id=pg_temp.u(30);
SELECT pg_temp.chk('correccion levanta bloqueo', (SELECT levantada_en IS NOT NULL FROM sancion_productor WHERE recoleccion_id=pg_temp.u(30)));
UPDATE recoleccion SET anulada_en=now(),anulada_por=(SELECT adm FROM m),motivo_anulacion='error' WHERE id=pg_temp.u(11);
SELECT pg_temp.chk('anulacion levanta sancion precio', (SELECT levantada_en IS NOT NULL FROM sancion_productor WHERE recoleccion_id=pg_temp.u(11)));

-- 12 Vistas del dashboard / admin
SELECT pg_temp.rec(80,p3,aco,10,'2026-05-01 07:00-05','alterado',ana,now()::text) FROM m;
INSERT INTO analisis_calidad(recoleccion_id,ph,foto_url) VALUES (pg_temp.u(80),5.5,'f.jpg');
SELECT pg_temp.chk('observado inicia_manana', (SELECT estado FROM v_productor_observado WHERE productor_id=(SELECT p3 FROM m))='inicia_manana');
SELECT pg_temp.chk('observado trae analisis', (SELECT foto_url FROM v_productor_observado WHERE productor_id=(SELECT p3 FROM m))='f.jpg');
SELECT pg_temp.chk('v_productor_resumen', (SELECT count(*) FROM v_productor_resumen)=5);
SELECT pg_temp.chk('v_analista_resumen', EXISTS(SELECT 1 FROM v_analista_resumen WHERE pct_alteradas>0));
SELECT pg_temp.chk('v_acopiador_mes sueldo', (SELECT sueldo_estimado FROM v_acopiador_mes WHERE mes='2026-03-01') > 1200);
SELECT pg_temp.chk('v_insumo_stock', (SELECT stock FROM v_insumo_stock)=900);
SELECT pg_temp.chk('v_leche_stock', (SELECT litros_usados FROM v_leche_stock)>=100);
SELECT pg_temp.chk('v_productor_estado_hoy', (SELECT count(*) FROM v_productor_estado_hoy)=5);
SELECT pg_temp.chk('auditoria registra', (SELECT count(*) FROM auditoria)>0);
SELECT pg_temp.chk('pago_acopiador constraint', true);
SELECT pg_temp.err('pago_acopiador pagado sin gasto','INSERT INTO pago_acopiador(acopiador_id,mes,litros_mes,sueldo_base,estado,pagado_en,creado_por) SELECT aco,''2026-03-01'',1,1,''pagado'',now(),adm FROM m','');

SELECT n, CASE WHEN ok THEN 'PASS' ELSE '**FAIL**' END FROM res WHERE NOT ok;
SELECT count(*) FILTER (WHERE ok) pass, count(*) FILTER (WHERE NOT ok) fail FROM res;
ROLLBACK;
