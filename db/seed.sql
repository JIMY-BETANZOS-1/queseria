-- =====================================================================
-- Datos de EJEMPLO para desarrollo y demostración.
-- TODO lo de este archivo es ficticio: reemplazar con los datos reales del cliente
-- desde el panel admin (rutas, productores, insumos, costos, recetas, sueldos).
--
-- Credenciales de prueba:
--   admin@queseria.test / Admin2026!   (web)
--   acopiadores y analista: PIN 1234   (móvil)
--
-- Las recolecciones se generan para los 14 días anteriores a hoy (fechas relativas),
-- todas revisadas por el analista; una queda marcada como alterada para mostrar la sanción.
-- Se carga sobre una base recién creada con schema.sql (ver db/scripts/crear-bd.ps1).
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Usuarios -- EJEMPLO
-- ---------------------------------------------------------------------
INSERT INTO usuario (rol, nombre_completo, dni, celular, email, password_hash) VALUES
  ('admin', 'Administrador de Prueba', NULL, '951000001', 'admin@queseria.test',
   '$2b$12$VYH37H45jP7dh2PWKMXI4.Iv5egFKnnSsSMaYV2AWgQ1FtPh4gp7S');            -- EJEMPLO: Admin2026!

-- Auditoría: los cambios del seed quedan a nombre del admin
DO $$ BEGIN
  PERFORM set_config('app.usuario_id', (SELECT id::text FROM usuario WHERE email = 'admin@queseria.test'), true);
END $$;

INSERT INTO usuario (rol, nombre_completo, dni, celular, pin_hash, pin_actualizado_en) VALUES
  ('acopiador', 'Juan Carlos Mamani Quispe',  '41234567', '951234567',
   '$2b$12$PBfR.hixJ9TdkgCGQk1f/edSA9R/5.eki4tqvT1zMpo5GnRaWkRxK', now()),  -- EJEMPLO: PIN 1234
  ('acopiador', 'Rosa Elena Condori Apaza',   '42345678', '952345678',
   '$2b$12$PBfR.hixJ9TdkgCGQk1f/edSA9R/5.eki4tqvT1zMpo5GnRaWkRxK', now()),  -- EJEMPLO: PIN 1234
  ('analista',  'Edwin Ramiro Huanca Ticona', '43456789', '953456789',
   '$2b$12$PBfR.hixJ9TdkgCGQk1f/edSA9R/5.eki4tqvT1zMpo5GnRaWkRxK', now());  -- EJEMPLO: PIN 1234

INSERT INTO acopiador (usuario_id, color_hex, vehiculo, sueldo_base_mensual, comision_por_litro)
SELECT u.id, v.color, v.vehiculo::tipo_vehiculo, v.sueldo, v.comision
FROM (VALUES
  ('41234567', '#2563EB', 'motocarga',   900.00, 0.050),   -- EJEMPLO
  ('42345678', '#16A34A', 'moto_lineal', 800.00, 0.050)    -- EJEMPLO
) AS v(dni, color, vehiculo, sueldo, comision)
JOIN usuario u ON u.dni = v.dni;

-- ---------------------------------------------------------------------
-- Rutas y asignación -- EJEMPLO
-- ---------------------------------------------------------------------
INSERT INTO ruta (nombre, descripcion) VALUES
  ('Ruta 1 - Huata Centro', 'EJEMPLO: comunidades alrededor de la plaza de Huata'),
  ('Ruta 2 - Orilla del lago', 'EJEMPLO: comunidades ribereñas hacia el lago Titicaca'),
  ('Ruta 3 - Carretera a Coata', 'EJEMPLO: productores a lo largo de la carretera a Coata');

INSERT INTO ruta_acopiador (ruta_id, acopiador_id, vigente_desde)
SELECT r.id, u.id, current_date - 30
FROM (VALUES
  ('Ruta 1 - Huata Centro',     '41234567'),   -- EJEMPLO
  ('Ruta 2 - Orilla del lago',  '41234567'),   -- EJEMPLO
  ('Ruta 3 - Carretera a Coata','42345678')    -- EJEMPLO
) AS v(ruta, dni)
JOIN ruta r ON r.nombre = v.ruta
JOIN usuario u ON u.dni = v.dni;

-- ---------------------------------------------------------------------
-- Productores -- EJEMPLO (nombres ficticios; ubicaciones aproximadas en Huata)
-- orden = orden de visita dentro de la ruta; litros_base = producción diaria típica
-- ---------------------------------------------------------------------
CREATE TEMP TABLE tmp_productor (
  nombre text, documento text, celular text, ruta text, orden int,
  lat numeric, lon numeric, litros_base numeric
) ON COMMIT DROP;

INSERT INTO tmp_productor VALUES
  -- Ruta 1 - Huata Centro
  ('Mario Quispe Mamani',         '40111201', '954100201', 'Ruta 1 - Huata Centro',      1, -15.6120, -69.9720, 22),
  ('Felícitas Apaza Condori',     '40111202', '954100202', 'Ruta 1 - Huata Centro',      2, -15.6085, -69.9690, 15),
  ('Teodoro Choque Huanca',       '40111203', '954100203', 'Ruta 1 - Huata Centro',      3, -15.6050, -69.9655, 30),
  ('Justina Ccama Pari',          '40111204', '954100204', 'Ruta 1 - Huata Centro',      4, -15.6015, -69.9620, 12),
  ('Eusebio Flores Coaquira',     '40111205', NULL,        'Ruta 1 - Huata Centro',      5, -15.5980, -69.9590, 18),
  -- Ruta 2 - Orilla del lago
  ('Paulina Mamani Chambi',       '40111206', '954100206', 'Ruta 2 - Orilla del lago',   1, -15.5950, -69.9520, 25),
  ('Cirilo Ticona Larico',        '40111207', '954100207', 'Ruta 2 - Orilla del lago',   2, -15.5925, -69.9475, 10),
  ('Gregoria Calsin Quispe',      '40111208', NULL,        'Ruta 2 - Orilla del lago',   3, -15.5900, -69.9430, 35),
  ('Valentín Huarachi Cutipa',    '40111209', '954100209', 'Ruta 2 - Orilla del lago',   4, -15.5875, -69.9385, 20),
  ('Lucía Pacompía Yucra',        '40111210', '954100210', 'Ruta 2 - Orilla del lago',   5, -15.5850, -69.9340, 14),
  -- Ruta 3 - Carretera a Coata
  ('Hilario Cahui Mamani',        '40111211', '954100211', 'Ruta 3 - Carretera a Coata', 1, -15.6180, -69.9800, 28),
  ('Martha Vilca Turpo',          '40111212', '954100212', 'Ruta 3 - Carretera a Coata', 2, -15.6220, -69.9850, 16),
  ('Benedicto Anccori Sucasaca',  '40111213', NULL,        'Ruta 3 - Carretera a Coata', 3, -15.6260, -69.9900, 40),
  ('Sabina Machaca Ccopa',        '40111214', '954100214', 'Ruta 3 - Carretera a Coata', 4, -15.6300, -69.9950, 11),
  ('Florencio Laura Chura',       '40111215', '954100215', 'Ruta 3 - Carretera a Coata', 5, -15.6340, -70.0000, 24);

INSERT INTO productor (nombre, documento, celular, tipo, ruta_id, latitud_ref, longitud_ref, creado_por)
SELECT t.nombre, t.documento, t.celular, 'de_ruta', r.id, t.lat, t.lon,
       (SELECT id FROM usuario WHERE email = 'admin@queseria.test')
FROM tmp_productor t
JOIN ruta r ON r.nombre = t.ruta
ORDER BY r.id, t.orden;

-- Externos: llegan directo a planta (documento y celular obligatorios)
INSERT INTO productor (nombre, documento, celular, tipo, creado_por) VALUES
  ('Agropecuaria Los Andes Huata S.R.L.', '20601234567', '955200001', 'externo',
   (SELECT id FROM usuario WHERE email = 'admin@queseria.test')),                -- EJEMPLO
  ('Nicolás Ccallo Mamani',               '40111216',    '955200002', 'externo',
   (SELECT id FROM usuario WHERE email = 'admin@queseria.test'));                -- EJEMPLO

-- ---------------------------------------------------------------------
-- Insumos con stock inicial y costo -- EJEMPLO (costos referenciales)
-- ---------------------------------------------------------------------
INSERT INTO insumo (nombre, unidad) VALUES
  ('Cuajo líquido',               'ml'),
  ('Cloruro de calcio',           'g'),
  ('Sal',                         'kg'),
  ('Cultivo láctico mesófilo',    'g'),
  ('Cultivo para yogurt',         'g'),
  ('Azúcar',                      'kg'),
  ('Envase de yogurt 1 kg',       'unidad'),
  ('Bolsa para queso',            'unidad');

INSERT INTO movimiento_insumo (insumo_id, tipo, cantidad, costo_unitario, usuario_id, fecha, nota)
SELECT i.id, 'stock_inicial', v.cantidad, v.costo,
       (SELECT id FROM usuario WHERE email = 'admin@queseria.test'),
       (current_date - 15)::timestamp AT TIME ZONE 'America/Lima',
       'EJEMPLO: stock inicial'
FROM (VALUES
  ('Cuajo líquido',            2000,   0.0800),   -- EJEMPLO: S/ por ml
  ('Cloruro de calcio',        5000,   0.0150),   -- EJEMPLO: S/ por g
  ('Sal',                        50,   1.5000),   -- EJEMPLO: S/ por kg
  ('Cultivo láctico mesófilo',  500,   0.9000),   -- EJEMPLO: S/ por g
  ('Cultivo para yogurt',       300,   1.2000),   -- EJEMPLO: S/ por g
  ('Azúcar',                    100,   3.8000),   -- EJEMPLO: S/ por kg
  ('Envase de yogurt 1 kg',     500,   0.8000),   -- EJEMPLO: S/ por unidad
  ('Bolsa para queso',         1000,   0.1500)    -- EJEMPLO: S/ por unidad
) AS v(nombre, cantidad, costo)
JOIN insumo i ON i.nombre = v.nombre;

-- ---------------------------------------------------------------------
-- Composición de las 4 recetas (ya sembradas por schema.sql) -- EJEMPLO
-- Quesos: rendimiento en UNIDADES por 100 L. Yogurt: en KILOS por 100 L.
-- ---------------------------------------------------------------------
UPDATE receta r
   SET litros_base = 100, rendimiento_base = v.rendimiento, dias_vida_util = v.vida
  FROM (VALUES
    ('Queso paria',        11.00, 30),   -- EJEMPLO
    ('Queso pasteurizado', 11.00, 21),   -- EJEMPLO
    ('Queso fresco',       12.00,  7),   -- EJEMPLO
    ('Yogurt',            105.00, 21)    -- EJEMPLO
  ) AS v(nombre, rendimiento, vida)
 WHERE r.nombre = v.nombre;

INSERT INTO receta_insumo (receta_id, insumo_id, cantidad)
SELECT r.id, i.id, v.cantidad
FROM (VALUES
  -- cantidades por 100 L de leche, en la unidad del insumo -- EJEMPLO
  ('Queso paria',        'Cuajo líquido',             20),
  ('Queso paria',        'Sal',                       1.5),
  ('Queso paria',        'Bolsa para queso',          11),
  ('Queso pasteurizado', 'Cuajo líquido',             20),
  ('Queso pasteurizado', 'Cloruro de calcio',         20),
  ('Queso pasteurizado', 'Cultivo láctico mesófilo',  5),
  ('Queso pasteurizado', 'Sal',                       1.2),
  ('Queso pasteurizado', 'Bolsa para queso',          11),
  ('Queso fresco',       'Cuajo líquido',             18),
  ('Queso fresco',       'Cloruro de calcio',         20),
  ('Queso fresco',       'Sal',                       1.0),
  ('Queso fresco',       'Bolsa para queso',          12),
  ('Yogurt',             'Cultivo para yogurt',       10),
  ('Yogurt',             'Azúcar',                    8),
  ('Yogurt',             'Envase de yogurt 1 kg',     105)
) AS v(receta, insumo, cantidad)
JOIN receta r ON r.nombre = v.receta
JOIN insumo i ON i.nombre = v.insumo;

-- ---------------------------------------------------------------------
-- Recolecciones de los últimos 14 días -- EJEMPLO
-- Ruta: el acopiador sale a las 06:00 y visita un productor cada 8 minutos (GPS a pocos
-- metros de la ubicación de referencia). Externos: llegan a planta día por medio a las 08:30.
-- Todas revisadas por el analista a las 10:00 del mismo día (normales).
-- Los litros varían de forma determinista (±20 %) para que el seed sea reproducible.
-- ---------------------------------------------------------------------
WITH dias AS (
  SELECT d::date AS dia, row_number() OVER (ORDER BY d) AS n
  FROM generate_series(current_date - 14, current_date - 1, interval '1 day') d
),
visitas AS (
  SELECT p.id AS productor_id,
         p.latitud_ref, p.longitud_ref,
         t.litros_base,
         ra.acopiador_id,
         row_number() OVER (PARTITION BY ra.acopiador_id ORDER BY p.ruta_id, t.orden) AS turno
  FROM productor p
  JOIN tmp_productor t ON t.documento = p.documento
  JOIN ruta_acopiador ra ON ra.ruta_id = p.ruta_id AND ra.vigente_hasta IS NULL
)
INSERT INTO recoleccion (id, productor_id, registrado_por, litros, registrada_en, recibida_en,
                         latitud, longitud, precision_m, origen_ubicacion, ubicacion_simulada,
                         hora_gps, hora_automatica, calidad_por, calidad_en)
SELECT gen_random_uuid(),
       v.productor_id,
       v.acopiador_id,
       round(v.litros_base * (0.8 + ((d.n * 7 + v.productor_id * 13) % 9) * 0.05), 1),
       h.ts,
       h.ts + interval '3 hours',
       v.latitud_ref  + (((d.n + v.productor_id) % 5) - 2) * 0.0001,
       v.longitud_ref + (((d.n * 3 + v.productor_id) % 5) - 2) * 0.0001,
       8 + (d.n + v.productor_id) % 12,
       'gps', false,
       h.ts, true,
       (SELECT id FROM usuario WHERE rol = 'analista' AND dni = '43456789'),
       (d.dia + time '10:00') AT TIME ZONE 'America/Lima'
FROM dias d
CROSS JOIN visitas v
CROSS JOIN LATERAL (
  SELECT ((d.dia + time '06:00') AT TIME ZONE 'America/Lima') + (v.turno - 1) * interval '8 minutes' AS ts
) h;

-- Externos en planta (día por medio)
WITH dias AS (
  SELECT d::date AS dia, row_number() OVER (ORDER BY d) AS n
  FROM generate_series(current_date - 14, current_date - 1, interval '1 day') d
)
INSERT INTO recoleccion (id, productor_id, registrado_por, litros, registrada_en, recibida_en,
                         latitud, longitud, precision_m, origen_ubicacion,
                         hora_gps, hora_automatica, calidad_por, calidad_en)
SELECT gen_random_uuid(),
       p.id,
       a.id,
       CASE WHEN p.documento = '20601234567' THEN 120 ELSE 45 END
         * (0.9 + ((d.n * 5 + p.id) % 5) * 0.05),
       h.ts,
       h.ts + interval '5 minutes',
       -15.6105, -69.9705, 10, 'gps',                      -- EJEMPLO: ubicación de la planta
       h.ts, true,
       a.id,
       (d.dia + time '10:00') AT TIME ZONE 'America/Lima'
FROM dias d
CROSS JOIN productor p
CROSS JOIN (SELECT id FROM usuario WHERE rol = 'analista' AND dni = '43456789') a
CROSS JOIN LATERAL (
  SELECT ((d.dia + time '08:30') AT TIME ZONE 'America/Lima')
         + CASE WHEN p.documento = '20601234567' THEN interval '0' ELSE interval '15 minutes' END AS ts
) h
WHERE p.tipo = 'externo'
  AND d.n % 2 = CASE WHEN p.documento = '20601234567' THEN 1 ELSE 0 END;

-- ---------------------------------------------------------------------
-- Una recolección alterada (hace 5 días) con su análisis -- EJEMPLO
-- El trigger crea la sanción de precio desde el día siguiente.
-- ---------------------------------------------------------------------
INSERT INTO analisis_calidad (recoleccion_id, ph, temperatura_c, grasa_pct, densidad, antibioticos_positivo)
SELECT r.id, 6.20, 14.0, 2.10, 1.024, false
FROM recoleccion r
JOIN productor p ON p.id = r.productor_id
WHERE p.documento = '40111208'
  AND (r.registrada_en AT TIME ZONE 'America/Lima')::date = current_date - 5;

UPDATE recoleccion r
   SET estado_calidad = 'alterado',
       observacion    = 'EJEMPLO: leche aguada (densidad baja)'
  FROM productor p
 WHERE p.id = r.productor_id
   AND p.documento = '40111208'
   AND (r.registrada_en AT TIME ZONE 'America/Lima')::date = current_date - 5;

COMMIT;
