-- =====================================================================
-- Sistema de Acopio y Producción de Queso — Huata, Puno
-- PostgreSQL 14+   (versión 3)
--
-- FLUJO DEL DINERO Y DE LA LECHE (todo cuadra de punta a punta)
--   Recolección -> revisión de calidad -> leche "aprobada" de la jornada
--   Jornada: lo pagado a productores / litros aprobados = costo por litro útil
--            (el costo de la leche descartada queda absorbido por la leche buena)
--   Cada lote toma leche de jornadas concretas (lote_leche) a ese costo.
--   Leche sin destino pasa a merma. Producto: se vende (al contado) o se da de baja.
--   Resultado = ventas − costo de lo vendido − pérdidas (bajas, mermas, días sin leche útil) − gastos operativos
--
-- MAPA PANTALLA -> OBJETOS
--   Dashboard            v_resultado_mensual, v_flujo_mensual, v_productor_observado, v_leche_stock,
--                        v_lote_disponible, v_acopiador_mes
--   Mapa / Recolecciones v_recoleccion_detalle (+ alerta_recoleccion)
--   Proveedores          v_productor_resumen, v_recoleccion_detalle
--   Acopiadores          acopiador, ruta_acopiador, v_acopiador_mes, pago_acopiador
--   Control de calidad   v_recoleccion_sin_revisar, v_productor_estado_hoy, v_analista_resumen, sancion_productor
--   Insumos              v_insumo_stock, movimiento_insumo
--   Recetas / Producción receta, receta_insumo, lote_produccion, lote_leche, lote_costo, v_leche_jornada, v_lote_resumen
--   Ventas               cliente, venta, venta_detalle, v_lote_disponible, baja_producto
--   Pagos a productores  v_pago_pendiente_productor, liquidacion_productor, v_liquidacion_productor
--   Gastos               gasto_operativo, categoria_gasto
--   Configuración        configuracion, precio_leche, usuario, dispositivo, codigo_activacion
--
-- REGLAS DE NEGOCIO QUE EL ESQUEMA HACE CUMPLIR
--   * Acopiador registra litros + GPS; analista registra calidad. Cada recolección se juzga sola.
--   * Leche alterada = se descarta (no entra al stock). ¿Se paga? -> configuracion.pagar_leche_alterada.
--   * Alterada el día D (fecha en que el analista la marca, hora del SERVIDOR):
--       primera vez  -> sanción de precio D+1 ... D+7 (0.70 en vez de 1.70)
--       reincidencia -> BLOQUEO D+1 ... D+7 (la semana se reinicia completa)
--   * Una leche alterada exige su análisis (al menos una medición o la foto).
--   * Solo se usa en producción y solo se paga leche YA REVISADA por el analista.
--   * Se retiene el pago de leche de productores bloqueados o aún no aprobados hasta que el admin decida.
--   * GPS nunca bloquea el registro: se guardan evidencias y el servidor levanta alertas.
--   * Productores se pagan por liquidación semanal (monto congelado); acopiadores por mes.
--   * Todas las ventas son al contado. Un lote cerrado no se altera.
--
-- Convenciones:
--   * Maestras: id bigint identity. Recolecciones: id uuid generado en el celular
--     (sincronización idempotente con INSERT ... ON CONFLICT DO NOTHING).
--   * Productores creados en el campo (sin internet) llevan uuid_cliente: la API los inserta
--     ANTES que sus recolecciones y las enlaza con el id real.
--   * actualizado_en permite el "pull" incremental hacia los celulares.
--   * Zona horaria de negocio: America/Lima.
--   * La API debe ejecutar  SET LOCAL app.usuario_id = '<id>'  en cada transacción
--     para que la auditoría sepa quién hizo el cambio.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Tipos enumerados
-- ---------------------------------------------------------------------
CREATE TYPE rol_usuario        AS ENUM ('admin', 'acopiador', 'analista');
CREATE TYPE tipo_vehiculo      AS ENUM ('moto_lineal', 'motocarga', 'vehiculo_mediano');
CREATE TYPE tipo_productor     AS ENUM ('de_ruta', 'externo');
CREATE TYPE estado_calidad     AS ENUM ('normal', 'alterado');
CREATE TYPE unidad_insumo      AS ENUM ('kg', 'g', 'l', 'ml', 'unidad');
CREATE TYPE unidad_venta       AS ENUM ('unidad', 'kilo');
CREATE TYPE tipo_mov_insumo    AS ENUM ('stock_inicial', 'ingreso', 'consumo_lote', 'ajuste');
CREATE TYPE concepto_costo     AS ENUM ('electricidad', 'mano_obra', 'combustible', 'otro');
CREATE TYPE estado_lote        AS ENUM ('en_proceso', 'cerrado');
CREATE TYPE tipo_persona       AS ENUM ('natural', 'empresa');
CREATE TYPE tipo_precio_leche  AS ENUM ('normal', 'sancion');
CREATE TYPE tipo_sancion       AS ENUM ('precio', 'bloqueo');
CREATE TYPE origen_ubicacion   AS ENUM ('gps', 'ultima_conocida', 'ninguna');
CREATE TYPE motivo_baja        AS ENUM ('merma', 'vencido', 'muestra', 'otro');
CREATE TYPE estado_pago        AS ENUM ('pendiente', 'pagado');
CREATE TYPE tipo_alerta        AS ENUM (
  'sin_ubicacion',        -- recolección de ruta sin GPS
  'ubicacion_simulada',   -- Android detectó ubicación falsa
  'ubicacion_imprecisa',  -- ubicación estimada o con precisión peor que max_precision_gps_m
  'lejos_del_productor',  -- más lejos que max_distancia_productor_m de la ubicación de referencia del productor
  'hora_inconsistente',   -- hora del celular vs hora GPS vs hora del servidor, o celular sin hora automática
  'velocidad_imposible',  -- desplazamiento irreal entre dos recolecciones del mismo acopiador
  'firma_invalida',       -- la firma del registro no coincide (la crea la API: la base no verifica firmas) -> RETIENE EL PAGO
  'productor_bloqueado',  -- se recibió leche de un productor bloqueado -> RETIENE EL PAGO
  'litros_atipicos',      -- litros muy distintos a lo habitual del productor
  'posible_duplicado'     -- mismo productor y mismos litros en pocos minutos
);

-- ---------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------
CREATE FUNCTION fn_actualizado_en() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- Configuración
-- ---------------------------------------------------------------------
CREATE TABLE configuracion (
  clave       text PRIMARY KEY,
  valor       text NOT NULL,
  descripcion text
);

INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('dias_sancion',               '7',        'Duración de la sanción de precio y del bloqueo, en días'),
  ('dias_gracia_reincidencia',   '7',        'Días después de terminada una sanción en los que una nueva alteración cuenta como reincidencia'),
  ('pagar_leche_alterada',       'true',     'true = la leche alterada del día se paga (su costo lo absorbe la leche buena); false = no se paga'),
  ('comision_incluye_descartada','false',    'false = la comisión del acopiador se calcula solo sobre litros normales; true = sobre todos'),
  ('dias_max_leche',             '1',        'Días que puede quedar leche aprobada sin lote; pasado ese plazo aparece como "sin destino" para registrar su merma'),
  ('dias_alerta_vencimiento',    '2',        'Un lote cerrado con saldo se marca "por vencer" cuando faltan estos días o menos'),
  ('color_externo',              '#6B7280',  'Color con el que se muestran los productores externos'),
  ('empresa_nombre',             'Quesería Huata', 'Nombre que aparece en reportes y comprobantes'),
  ('max_distancia_productor_m',  '300',      'Alerta si la recolección queda más lejos que esto de la ubicación de referencia del productor'),
  ('max_precision_gps_m',        '100',      'Alerta si la precisión del GPS es peor que esto'),
  ('max_desfase_hora_min',       '10',       'Alerta si la hora del celular difiere más que esto de la hora GPS o del servidor'),
  ('max_velocidad_kmh',          '80',       'Alerta si dos recolecciones del mismo acopiador implican ir más rápido que esto'),
  ('factor_litros_atipicos',     '3',        'Alerta si los litros son más de N veces (o menos de 1/N) del promedio reciente del productor');

-- ---------------------------------------------------------------------
-- Usuarios (admin, acopiador, analista)
-- ---------------------------------------------------------------------
CREATE TABLE usuario (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rol                   rol_usuario NOT NULL,
  nombre_completo       text        NOT NULL,
  dni                   varchar(8)  UNIQUE,
  celular               varchar(9),
  email                 text        UNIQUE,
  password_hash         text,                 -- solo admin (web)
  pin_hash              text,                 -- acopiador y analista (app móvil); NULL = pendiente de activar:
                                              -- el propio usuario crea su PIN al activar el celular
  pin_actualizado_en    timestamptz,          -- cuándo el usuario creó su PIN (NULL = PIN heredado del admin o sin PIN)
  pin_intentos_fallidos smallint    NOT NULL DEFAULT 0,
  bloqueado_hasta       timestamptz,          -- bloqueo temporal tras varios PIN incorrectos
  activo                boolean     NOT NULL DEFAULT true,
  creado_en             timestamptz NOT NULL DEFAULT now(),
  actualizado_en        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_usuario_id_rol UNIQUE (id, rol),
  CONSTRAINT ck_usuario_dni     CHECK (dni     ~ '^[0-9]{8}$'),
  CONSTRAINT ck_usuario_celular CHECK (celular ~ '^[0-9]{9}$'),
  CONSTRAINT ck_usuario_credenciales CHECK (
    (rol = 'admin'
       AND email IS NOT NULL AND password_hash IS NOT NULL)
    OR
    (rol IN ('acopiador', 'analista')
       AND dni IS NOT NULL AND celular IS NOT NULL)
  ),
  -- No hay fecha de PIN sin PIN
  CONSTRAINT ck_usuario_pin_fecha CHECK (pin_actualizado_en IS NULL OR pin_hash IS NOT NULL)
);
CREATE TRIGGER trg_usuario_act BEFORE UPDATE ON usuario
  FOR EACH ROW EXECUTE FUNCTION fn_actualizado_en();

-- Acceso móvil estilo Yape: el celular se vincula UNA vez con un código que genera
-- el admin; después el usuario entra solo con su PIN (teclado con dígitos mezclados,
-- bloqueo tras intentos fallidos). El PIN no identifica al usuario: lo identifica
-- el dispositivo vinculado.
CREATE TABLE codigo_activacion (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id  bigint      NOT NULL REFERENCES usuario (id) ON DELETE CASCADE,
  codigo_hash text        NOT NULL,
  creado_por  bigint      NOT NULL REFERENCES usuario (id),
  creado_en   timestamptz NOT NULL DEFAULT now(),
  expira_en   timestamptz NOT NULL,
  usado_en    timestamptz
);
CREATE INDEX ix_codigo_activacion_usuario ON codigo_activacion (usuario_id);

CREATE TABLE dispositivo (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id    bigint      NOT NULL REFERENCES usuario (id) ON DELETE CASCADE,
  device_uuid   text        NOT NULL UNIQUE,
  modelo        text,
  clave_publica text,                       -- la app firma cada recolección con su clave privada (Android Keystore)
  activado_en   timestamptz NOT NULL DEFAULT now(),
  ultimo_acceso timestamptz,
  activo        boolean     NOT NULL DEFAULT true
);
-- Un solo celular activo por usuario; si se pierde, el admin lo desactiva y emite otro código
CREATE UNIQUE INDEX uq_dispositivo_activo_por_usuario ON dispositivo (usuario_id) WHERE activo;

-- Datos propios del acopiador: color de ruta, vehículo y condiciones de pago mensual
CREATE TABLE acopiador (
  usuario_id           bigint PRIMARY KEY,
  rol                  rol_usuario    NOT NULL DEFAULT 'acopiador',
  color_hex            char(7)        NOT NULL UNIQUE,
  vehiculo             tipo_vehiculo  NOT NULL,
  sueldo_base_mensual  numeric(10,2)  NOT NULL DEFAULT 0 CHECK (sueldo_base_mensual >= 0),
  comision_por_litro   numeric(6,3)   NOT NULL DEFAULT 0 CHECK (comision_por_litro >= 0),
  actualizado_en       timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT ck_acopiador_rol   CHECK (rol = 'acopiador'),
  CONSTRAINT ck_acopiador_color CHECK (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT fk_acopiador_usuario FOREIGN KEY (usuario_id, rol)
    REFERENCES usuario (id, rol) ON DELETE CASCADE
);
CREATE TRIGGER trg_acopiador_act BEFORE UPDATE ON acopiador
  FOR EACH ROW EXECUTE FUNCTION fn_actualizado_en();

-- ---------------------------------------------------------------------
-- Rutas y productores
-- ---------------------------------------------------------------------
CREATE TABLE ruta (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre         text    NOT NULL UNIQUE,
  descripcion    text,
  activa         boolean NOT NULL DEFAULT true,
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_ruta_act BEFORE UPDATE ON ruta
  FOR EACH ROW EXECUTE FUNCTION fn_actualizado_en();

-- Asignación de rutas a acopiadores (con historial).
-- Un acopiador puede tener varias rutas; una ruta tiene un solo acopiador vigente.
CREATE TABLE ruta_acopiador (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ruta_id        bigint NOT NULL REFERENCES ruta (id),
  acopiador_id   bigint NOT NULL REFERENCES acopiador (usuario_id),
  vigente_desde  date   NOT NULL DEFAULT current_date,
  vigente_hasta  date,
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_ruta_acopiador_fechas CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
);
CREATE UNIQUE INDEX uq_ruta_un_acopiador_vigente
  ON ruta_acopiador (ruta_id) WHERE vigente_hasta IS NULL;
CREATE INDEX ix_ruta_acopiador_acopiador ON ruta_acopiador (acopiador_id);
CREATE TRIGGER trg_ruta_acopiador_act BEFORE UPDATE ON ruta_acopiador
  FOR EACH ROW EXECUTE FUNCTION fn_actualizado_en();

-- Productores: de ruta (asignados a una ruta) o externos (llegan directo a planta).
--   codigo        : etiqueta/QR del tarro del productor (el analista lo escanea para abrir su recolección).
--   aprobado      : los productores dados de alta en el campo por un acopiador nacen NO aprobados;
--                   su leche se recibe y se registra, pero su pago queda retenido hasta que el admin los apruebe.
--   uuid_cliente  : id generado en el celular para altas sin internet.
--   latitud_ref   : dónde queda realmente el productor; la fija la primera recolección con buen GPS
--                   (o el admin) y sirve para detectar recolecciones registradas lejos.
-- El color NO se guarda: sale del acopiador que recolecta, o de configuracion.color_externo.
CREATE SEQUENCE seq_productor_codigo;

CREATE TABLE productor (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo         text          NOT NULL UNIQUE DEFAULT ('P-' || lpad(nextval('seq_productor_codigo')::text, 4, '0')),
  nombre         text          NOT NULL,         -- persona o empresa
  documento      varchar(11),                    -- DNI (8) o RUC (11)
  celular        varchar(9),
  tipo           tipo_productor NOT NULL DEFAULT 'de_ruta',
  ruta_id        bigint REFERENCES ruta (id),
  latitud_ref    numeric(9,6),
  longitud_ref   numeric(9,6),
  aprobado       boolean       NOT NULL DEFAULT true,
  creado_por     bigint        REFERENCES usuario (id),
  uuid_cliente   uuid          UNIQUE,
  activo         boolean       NOT NULL DEFAULT true,
  actualizado_en timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT ck_productor_documento CHECK (documento ~ '^[0-9]{8}([0-9]{3})?$'),
  CONSTRAINT ck_productor_celular   CHECK (celular ~ '^[0-9]{9}$'),
  CONSTRAINT ck_productor_ref       CHECK ((latitud_ref IS NULL) = (longitud_ref IS NULL)),
  CONSTRAINT ck_productor_tipo CHECK (
    (tipo = 'de_ruta' AND ruta_id IS NOT NULL)
    OR
    (tipo = 'externo' AND ruta_id IS NULL AND documento IS NOT NULL AND celular IS NOT NULL)
  )
);
CREATE UNIQUE INDEX uq_productor_documento ON productor (documento) WHERE documento IS NOT NULL;
CREATE INDEX ix_productor_ruta ON productor (ruta_id);
CREATE TRIGGER trg_productor_act BEFORE UPDATE ON productor
  FOR EACH ROW EXECUTE FUNCTION fn_actualizado_en();

CREATE FUNCTION fn_productor_alta() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.creado_por IS NOT NULL
     AND (SELECT rol FROM usuario WHERE id = NEW.creado_por) = 'acopiador' THEN
    NEW.aprobado := false;      -- alta en el campo: queda pendiente de aprobación del admin
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_productor_alta BEFORE INSERT ON productor
  FOR EACH ROW EXECUTE FUNCTION fn_productor_alta();

-- ---------------------------------------------------------------------
-- Recolección y control de calidad
-- ---------------------------------------------------------------------
-- id uuid lo genera el celular. registrado_por = acopiador (productor de ruta)
-- o analista (productor externo recibido en planta); el admin puede cargar cualquiera.
-- Calidad: nace 'normal' y SIN revisar (calidad_en IS NULL). El analista:
--   * marca 'alterado' (obligatorio calidad_por/calidad_en y su análisis), o
--   * confirma la revisión de las normales (la API rellena calidad_por/calidad_en).
-- calidad_en es hora del SERVIDOR (nunca del celular). Solo la leche revisada se usa y se paga.
-- Nunca se borra: se ANULA con motivo (queda historial).
CREATE TABLE recoleccion (
  id                 uuid PRIMARY KEY,
  productor_id       bigint        NOT NULL REFERENCES productor (id),
  ruta_id            bigint        REFERENCES ruta (id),          -- se completa sola desde el productor
  registrado_por     bigint        NOT NULL REFERENCES usuario (id),
  dispositivo_id     bigint        REFERENCES dispositivo (id),
  litros             numeric(8,2)  NOT NULL CHECK (litros > 0),
  observacion        text,
  registrada_en      timestamptz   NOT NULL,                      -- hora del celular
  recibida_en        timestamptz   NOT NULL DEFAULT now(),        -- hora en que llegó al servidor
  -- ubicación y evidencias antifraude (nunca bloquean el registro)
  latitud            numeric(9,6),
  longitud           numeric(9,6),
  precision_m        numeric(7,1),
  origen_ubicacion   origen_ubicacion NOT NULL DEFAULT 'gps',
  ubicacion_simulada boolean       NOT NULL DEFAULT false,        -- Location.isMock del sistema Android
  hora_gps           timestamptz,                                 -- hora que reporta el satélite
  hora_automatica    boolean,                                     -- ¿el celular tenía hora automática?
  hash_anterior      text,                                        -- cadena: firma del registro previo del mismo celular
  firma              text,                                        -- firma digital del registro (clave en Keystore)
  -- calidad
  estado_calidad     estado_calidad NOT NULL DEFAULT 'normal',
  calidad_por        bigint        REFERENCES usuario (id),
  calidad_en         timestamptz,
  -- anulación
  anulada_en         timestamptz,
  anulada_por        bigint        REFERENCES usuario (id),
  motivo_anulacion   text,
  actualizado_en     timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT ck_recoleccion_lat   CHECK (latitud  BETWEEN -90  AND 90),
  CONSTRAINT ck_recoleccion_lon   CHECK (longitud BETWEEN -180 AND 180),
  CONSTRAINT ck_recoleccion_gps   CHECK ((latitud IS NULL) = (longitud IS NULL)),
  CONSTRAINT ck_recoleccion_orig  CHECK ((origen_ubicacion = 'ninguna') = (latitud IS NULL)),
  CONSTRAINT ck_recoleccion_calidad CHECK (
    estado_calidad = 'normal' OR (calidad_por IS NOT NULL AND calidad_en IS NOT NULL)
  ),
  CONSTRAINT ck_recoleccion_anulacion CHECK (
    (anulada_en IS NULL AND anulada_por IS NULL AND motivo_anulacion IS NULL)
    OR
    (anulada_en IS NOT NULL AND anulada_por IS NOT NULL AND motivo_anulacion IS NOT NULL)
  )
);
CREATE INDEX ix_recoleccion_productor_fecha   ON recoleccion (productor_id, registrada_en DESC);
CREATE INDEX ix_recoleccion_registrador_fecha ON recoleccion (registrado_por, registrada_en DESC);
CREATE INDEX ix_recoleccion_fecha             ON recoleccion (registrada_en DESC);
CREATE INDEX ix_recoleccion_actualizado       ON recoleccion (actualizado_en);
CREATE INDEX ix_recoleccion_sin_revisar       ON recoleccion (registrada_en) WHERE calidad_en IS NULL AND anulada_en IS NULL;
CREATE TRIGGER trg_recoleccion_act BEFORE UPDATE ON recoleccion
  FOR EACH ROW EXECUTE FUNCTION fn_actualizado_en();

-- Detalle del análisis. Una recolección alterada exige al menos una medición o la foto.
CREATE TABLE analisis_calidad (
  recoleccion_id        uuid PRIMARY KEY REFERENCES recoleccion (id) ON DELETE CASCADE,
  ph                    numeric(4,2),
  temperatura_c         numeric(4,1),
  grasa_pct             numeric(4,2),
  densidad              numeric(6,3),
  antibioticos_positivo boolean,
  foto_url              text,                               -- opcional
  creado_en             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_analisis_ph    CHECK (ph BETWEEN 0 AND 14),
  CONSTRAINT ck_analisis_grasa CHECK (grasa_pct BETWEEN 0 AND 100)
);

-- Alertas de sospecha. Las generan los triggers al registrar la recolección (salvo firma_invalida,
-- que la crea la API). Solo 'productor_bloqueado' y 'firma_invalida' RETIENEN el pago hasta que el
-- admin las revise; el resto es informativo y nunca bloquea nada.
CREATE TABLE alerta_recoleccion (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recoleccion_id uuid        NOT NULL REFERENCES recoleccion (id) ON DELETE CASCADE,
  tipo           tipo_alerta NOT NULL,
  detalle        text,
  creada_en      timestamptz NOT NULL DEFAULT now(),
  revisada_por   bigint      REFERENCES usuario (id),
  revisada_en    timestamptz,
  resolucion     text,
  CONSTRAINT uq_alerta UNIQUE (recoleccion_id, tipo),
  CONSTRAINT ck_alerta_revision CHECK ((revisada_en IS NULL) = (revisada_por IS NULL))
);
CREATE INDEX ix_alerta_pendiente ON alerta_recoleccion (creada_en) WHERE revisada_en IS NULL;

-- ---------------------------------------------------------------------
-- Sanciones de productores (castigo de precio y bloqueo)
-- ---------------------------------------------------------------------
-- hasta es INCLUSIVE. Las crea el trigger fn_aplicar_sancion al marcarse 'alterado',
-- o el admin a mano (recoleccion_id NULL). Se levantan (no se borran) con levantada_en.
CREATE TABLE sancion_productor (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  productor_id    bigint       NOT NULL REFERENCES productor (id),
  tipo            tipo_sancion NOT NULL,
  desde           date         NOT NULL,
  hasta           date         NOT NULL,
  recoleccion_id  uuid         REFERENCES recoleccion (id),     -- la recolección alterada que la originó
  motivo          text,
  creada_en       timestamptz  NOT NULL DEFAULT now(),
  levantada_en    timestamptz,
  levantada_por   bigint       REFERENCES usuario (id),
  CONSTRAINT ck_sancion_fechas CHECK (hasta >= desde)
);
CREATE INDEX ix_sancion_productor ON sancion_productor (productor_id, desde, hasta) WHERE levantada_en IS NULL;
CREATE INDEX ix_sancion_recoleccion ON sancion_productor (recoleccion_id);

-- ---------------------------------------------------------------------
-- Funciones auxiliares
-- ---------------------------------------------------------------------
-- Distancia en metros entre dos coordenadas (haversine)
CREATE FUNCTION fn_distancia_m(lat1 numeric, lon1 numeric, lat2 numeric, lon2 numeric) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT (2 * 6371000 * asin(LEAST(1.0::float8, sqrt(
            power(sin(radians((lat2 - lat1)::float8) / 2), 2)
          + cos(radians(lat1::float8)) * cos(radians(lat2::float8))
            * power(sin(radians((lon2 - lon1)::float8) / 2), 2)))))::numeric;
$$;

CREATE FUNCTION fn_crear_alerta(p_recoleccion uuid, p_tipo tipo_alerta, p_detalle text) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO alerta_recoleccion (recoleccion_id, tipo, detalle)
  VALUES (p_recoleccion, p_tipo, p_detalle)
  ON CONFLICT (recoleccion_id, tipo) DO NOTHING;
$$;

-- ¿El productor tiene alguna sanción (precio o bloqueo) ese día?
CREATE FUNCTION fn_en_sancion(p_productor bigint, p_fecha date) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM sancion_productor s
    WHERE s.productor_id = p_productor
      AND s.levantada_en IS NULL
      AND p_fecha BETWEEN s.desde AND s.hasta
  );
$$;

-- ---------------------------------------------------------------------
-- Reglas de la recolección (triggers)
-- ---------------------------------------------------------------------
-- BEFORE: separación de funciones y ruta automática.
--   * El acopiador solo registra productores de ruta; el analista solo externos; el admin cualquiera.
--   * Solo analista o admin pueden fijar la calidad.
--   * ruta_id se copia del productor (los externos no tienen ruta).
CREATE FUNCTION fn_validar_recoleccion() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_tipo tipo_productor;
  v_ruta bigint;
  v_rol  rol_usuario;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT tipo, ruta_id INTO v_tipo, v_ruta FROM productor WHERE id = NEW.productor_id;
    SELECT rol INTO v_rol FROM usuario WHERE id = NEW.registrado_por;
    IF v_rol = 'acopiador' AND v_tipo IS DISTINCT FROM 'de_ruta' THEN
      RAISE EXCEPTION 'Un acopiador solo registra productores de ruta';
    END IF;
    IF v_rol = 'analista' AND v_tipo IS DISTINCT FROM 'externo' THEN
      RAISE EXCEPTION 'El analista solo registra productores externos';
    END IF;
    NEW.ruta_id := CASE WHEN v_tipo = 'externo' THEN NULL ELSE COALESCE(NEW.ruta_id, v_ruta) END;
  END IF;

  IF NEW.calidad_por IS NOT NULL
     AND (SELECT rol FROM usuario WHERE id = NEW.calidad_por) NOT IN ('analista', 'admin') THEN
    RAISE EXCEPTION 'Solo un analista o el admin puede registrar la calidad';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_recoleccion_validar BEFORE INSERT OR UPDATE ON recoleccion
  FOR EACH ROW EXECUTE FUNCTION fn_validar_recoleccion();

-- AFTER INSERT: genera las alertas de sospecha (nada de esto bloquea el registro).
CREATE FUNCTION fn_alertas_recoleccion() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_dia      date := (NEW.registrada_en AT TIME ZONE 'America/Lima')::date;
  v_max_dist numeric := (SELECT valor::numeric FROM configuracion WHERE clave = 'max_distancia_productor_m');
  v_max_prec numeric := (SELECT valor::numeric FROM configuracion WHERE clave = 'max_precision_gps_m');
  v_max_desf numeric := (SELECT valor::numeric FROM configuracion WHERE clave = 'max_desfase_hora_min');
  v_max_vel  numeric := (SELECT valor::numeric FROM configuracion WHERE clave = 'max_velocidad_kmh');
  v_factor   numeric := (SELECT valor::numeric FROM configuracion WHERE clave = 'factor_litros_atipicos');
  v_tipo     tipo_productor;
  v_ref_lat  numeric;
  v_ref_lon  numeric;
  v_dist     numeric;
  v_prev     record;
  v_horas    numeric;
  v_prom     numeric;
  v_n        int;
BEGIN
  SELECT tipo, latitud_ref, longitud_ref INTO v_tipo, v_ref_lat, v_ref_lon
    FROM productor WHERE id = NEW.productor_id;

  -- Leche de un productor bloqueado: se registra, pero su pago queda retenido hasta que el admin decida
  IF EXISTS (SELECT 1 FROM sancion_productor s
             WHERE s.productor_id = NEW.productor_id AND s.tipo = 'bloqueo'
               AND s.levantada_en IS NULL AND v_dia BETWEEN s.desde AND s.hasta) THEN
    PERFORM fn_crear_alerta(NEW.id, 'productor_bloqueado', 'Se recibió leche de un productor bloqueado');
  END IF;

  -- Posible duplicado: mismo productor y mismos litros con menos de 30 minutos de diferencia
  IF EXISTS (SELECT 1 FROM recoleccion r
             WHERE r.productor_id = NEW.productor_id AND r.id <> NEW.id AND r.anulada_en IS NULL
               AND r.litros = NEW.litros
               AND abs(extract(epoch FROM (r.registrada_en - NEW.registrada_en))) <= 1800) THEN
    PERFORM fn_crear_alerta(NEW.id, 'posible_duplicado', 'Mismo productor y litros registrados hace menos de 30 minutos');
  END IF;

  -- Litros atípicos frente a las últimas 10 recolecciones normales del productor (mínimo 5 de historial)
  SELECT avg(h.litros), count(*) INTO v_prom, v_n
    FROM (SELECT r.litros FROM recoleccion r
           WHERE r.productor_id = NEW.productor_id AND r.id <> NEW.id AND r.anulada_en IS NULL
             AND r.estado_calidad = 'normal' AND r.registrada_en < NEW.registrada_en
           ORDER BY r.registrada_en DESC LIMIT 10) h;
  IF v_n >= 5 AND (NEW.litros > v_prom * v_factor OR NEW.litros < v_prom / v_factor) THEN
    PERFORM fn_crear_alerta(NEW.id, 'litros_atipicos',
      format('%s L frente a un promedio reciente de %s L', NEW.litros, round(v_prom, 1)));
  END IF;

  -- Hora: celular sin hora automática, desfase con el GPS, o registro "del futuro"
  IF NEW.hora_automatica IS FALSE
     OR (NEW.hora_gps IS NOT NULL AND abs(extract(epoch FROM (NEW.registrada_en - NEW.hora_gps))) > v_max_desf * 60)
     OR NEW.registrada_en > NEW.recibida_en + (v_max_desf::float8 * interval '1 minute') THEN
    PERFORM fn_crear_alerta(NEW.id, 'hora_inconsistente', 'La hora del celular no coincide con la del GPS o del servidor');
  END IF;

  -- Alertas de ubicación: solo para recolecciones de ruta (las de externos ocurren en planta)
  IF v_tipo = 'de_ruta' THEN
    IF NEW.origen_ubicacion = 'ninguna' THEN
      PERFORM fn_crear_alerta(NEW.id, 'sin_ubicacion', 'No hubo señal GPS al registrar');
    END IF;

    IF NEW.ubicacion_simulada THEN
      PERFORM fn_crear_alerta(NEW.id, 'ubicacion_simulada', 'Android detectó una ubicación simulada');
    END IF;

    IF NEW.latitud IS NOT NULL AND (NEW.origen_ubicacion <> 'gps' OR NEW.precision_m > v_max_prec) THEN
      PERFORM fn_crear_alerta(NEW.id, 'ubicacion_imprecisa', 'Ubicación estimada o con precisión insuficiente');
    END IF;

    IF NEW.latitud IS NOT NULL AND NOT NEW.ubicacion_simulada THEN
      IF v_ref_lat IS NULL THEN
        -- primera visita con buen GPS: queda como ubicación de referencia del productor
        IF NEW.origen_ubicacion = 'gps' AND (NEW.precision_m IS NULL OR NEW.precision_m <= v_max_prec) THEN
          UPDATE productor SET latitud_ref = NEW.latitud, longitud_ref = NEW.longitud WHERE id = NEW.productor_id;
        END IF;
      ELSE
        v_dist := fn_distancia_m(v_ref_lat, v_ref_lon, NEW.latitud, NEW.longitud);
        IF v_dist > v_max_dist THEN
          PERFORM fn_crear_alerta(NEW.id, 'lejos_del_productor',
            format('A %s m de la ubicación de referencia del productor', round(v_dist)));
        END IF;
      END IF;

      -- Velocidad imposible respecto a la recolección anterior del mismo acopiador (últimas 12 h)
      SELECT r.latitud, r.longitud, r.registrada_en INTO v_prev
        FROM recoleccion r
       WHERE r.registrado_por = NEW.registrado_por AND r.id <> NEW.id AND r.anulada_en IS NULL
         AND r.latitud IS NOT NULL AND r.registrada_en < NEW.registrada_en
         AND r.registrada_en > NEW.registrada_en - interval '12 hours'
       ORDER BY r.registrada_en DESC LIMIT 1;
      IF FOUND THEN
        v_dist  := fn_distancia_m(v_prev.latitud, v_prev.longitud, NEW.latitud, NEW.longitud);
        v_horas := GREATEST(extract(epoch FROM (NEW.registrada_en - v_prev.registrada_en)) / 3600.0, 1.0 / 3600);
        IF (v_dist / 1000.0) / v_horas > v_max_vel THEN
          PERFORM fn_crear_alerta(NEW.id, 'velocidad_imposible',
            format('%s km/h respecto a la recolección anterior', round((v_dist / 1000.0) / v_horas)));
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_recoleccion_alertas AFTER INSERT ON recoleccion
  FOR EACH ROW EXECUTE FUNCTION fn_alertas_recoleccion();

-- Una recolección alterada exige su análisis (se comprueba al final de la transacción,
-- para que la API pueda insertar la recolección y el análisis juntos).
CREATE FUNCTION fn_exigir_analisis() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.estado_calidad = 'alterado' AND NEW.anulada_en IS NULL AND NOT EXISTS (
       SELECT 1 FROM analisis_calidad a
        WHERE a.recoleccion_id = NEW.id
          AND (a.ph IS NOT NULL OR a.temperatura_c IS NOT NULL OR a.grasa_pct IS NOT NULL
               OR a.densidad IS NOT NULL OR a.antibioticos_positivo IS NOT NULL OR a.foto_url IS NOT NULL)) THEN
    RAISE EXCEPTION 'La recolección % alterada requiere su análisis de calidad', NEW.id;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_recoleccion_exigir_analisis
  AFTER INSERT OR UPDATE OF estado_calidad ON recoleccion
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_exigir_analisis();

-- Al marcarse una recolección como alterada el día D (fecha de calidad_en):
--   * Reincidencia = ya tenía sanción vigente ese día, o terminó hace <= dias_gracia_reincidencia.
--     -> BLOQUEO D+1 ... D+dias_sancion (la semana se reinicia completa).
--   * Primera vez  -> sanción de PRECIO D+1 ... D+dias_sancion.
--   * Si ya existe una sanción que empieza mañana (otra alteración del mismo día) no se duplica.
CREATE FUNCTION fn_aplicar_sancion() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_dia         date;
  v_dias        int;
  v_gracia      int;
  v_reincidente boolean;
BEGIN
  IF NEW.anulada_en IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_dia    := (NEW.calidad_en AT TIME ZONE 'America/Lima')::date;
  v_dias   := (SELECT valor::int FROM configuracion WHERE clave = 'dias_sancion');
  v_gracia := (SELECT valor::int FROM configuracion WHERE clave = 'dias_gracia_reincidencia');

  IF EXISTS (SELECT 1 FROM sancion_productor s
             WHERE s.productor_id = NEW.productor_id
               AND s.levantada_en IS NULL
               AND s.desde = v_dia + 1) THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM sancion_productor s
    WHERE s.productor_id = NEW.productor_id
      AND s.levantada_en IS NULL
      AND s.desde <= v_dia
      AND s.hasta + v_gracia >= v_dia
  ) INTO v_reincidente;

  INSERT INTO sancion_productor (productor_id, tipo, desde, hasta, recoleccion_id, motivo)
  VALUES (NEW.productor_id,
          CASE WHEN v_reincidente THEN 'bloqueo'::tipo_sancion ELSE 'precio'::tipo_sancion END,
          v_dia + 1,
          v_dia + v_dias,
          NEW.id,
          CASE WHEN v_reincidente THEN 'Reincidencia de leche alterada' ELSE 'Leche alterada' END);
  RETURN NEW;
END $$;

-- Si la calidad se corrige a 'normal' o la recolección se anula, se levanta lo que ella originó.
-- Limitación conocida: si el mismo día hubo DOS recolecciones alteradas del mismo productor y se
-- corrige justo la que originó la sanción, la sanción se levanta aunque la otra siga alterada;
-- en ese caso el admin la crea a mano (sancion_productor con recoleccion_id NULL).
CREATE FUNCTION fn_levantar_sancion_por_correccion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE sancion_productor
     SET levantada_en = now(),
         motivo = COALESCE(motivo || ' | ', '') || 'Levantada: calidad corregida o recolección anulada'
   WHERE recoleccion_id = OLD.id
     AND levantada_en IS NULL;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_recoleccion_sancion_ins AFTER INSERT ON recoleccion
  FOR EACH ROW WHEN (NEW.estado_calidad = 'alterado')
  EXECUTE FUNCTION fn_aplicar_sancion();
CREATE TRIGGER trg_recoleccion_sancion_upd AFTER UPDATE OF estado_calidad ON recoleccion
  FOR EACH ROW WHEN (NEW.estado_calidad = 'alterado' AND OLD.estado_calidad IS DISTINCT FROM NEW.estado_calidad)
  EXECUTE FUNCTION fn_aplicar_sancion();
CREATE TRIGGER trg_recoleccion_sancion_rev AFTER UPDATE OF estado_calidad, anulada_en ON recoleccion
  FOR EACH ROW WHEN (OLD.estado_calidad = 'alterado' AND OLD.anulada_en IS NULL
                     AND (NEW.estado_calidad = 'normal' OR NEW.anulada_en IS NOT NULL))
  EXECUTE FUNCTION fn_levantar_sancion_por_correccion();

-- ---------------------------------------------------------------------
-- Precio de la leche (lo que se paga al productor por litro)
-- ---------------------------------------------------------------------
-- Historial: para cambiarlo (ej. época verde baja a 1.20) el admin inserta una fila
-- nueva con su fecha de vigencia.
--   'normal'  -> precio habitual
--   'sancion' -> precio mientras el productor tiene sanción (de precio o bloqueo)
CREATE TABLE precio_leche (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tipo          tipo_precio_leche NOT NULL,
  precio_litro  numeric(7,3)      NOT NULL CHECK (precio_litro > 0),
  vigente_desde date              NOT NULL,
  creado_por    bigint            REFERENCES usuario (id),
  creado_en     timestamptz       NOT NULL DEFAULT now(),
  CONSTRAINT uq_precio_leche UNIQUE (tipo, vigente_desde)
);

INSERT INTO precio_leche (tipo, precio_litro, vigente_desde) VALUES
  ('normal',  1.70, DATE '2026-01-01'),
  ('sancion', 0.70, DATE '2026-01-01');

CREATE FUNCTION fn_precio_leche(p_tipo tipo_precio_leche, p_fecha date) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT precio_litro
  FROM precio_leche
  WHERE tipo = p_tipo AND vigente_desde <= p_fecha
  ORDER BY vigente_desde DESC
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------
-- Liquidación semanal de productores (congela los montos)
-- ---------------------------------------------------------------------
-- La cabecera solo guarda productor, periodo y estado; litros y monto salen del detalle
-- (v_liquidacion_productor) para que nunca se desfasen. Solo se liquida lo "pagable":
-- revisado por el analista y no retenido. Pagada la liquidación, nada se puede cambiar.
CREATE TABLE liquidacion_productor (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  productor_id bigint        NOT NULL REFERENCES productor (id),
  desde        date          NOT NULL,
  hasta        date          NOT NULL,
  estado       estado_pago   NOT NULL DEFAULT 'pendiente',
  pagada_en    timestamptz,
  pagada_por   bigint        REFERENCES usuario (id),
  creada_por   bigint        NOT NULL REFERENCES usuario (id),
  creada_en    timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT ck_liq_periodo CHECK (hasta >= desde),
  CONSTRAINT ck_liq_pago    CHECK ((estado = 'pagado') = (pagada_en IS NOT NULL)),
  CONSTRAINT uq_liq_periodo UNIQUE (productor_id, desde, hasta)
);

CREATE TABLE liquidacion_detalle (
  recoleccion_id uuid          PRIMARY KEY REFERENCES recoleccion (id),   -- una recolección se liquida una sola vez
  liquidacion_id bigint        NOT NULL REFERENCES liquidacion_productor (id) ON DELETE CASCADE,
  litros         numeric(8,2)  NOT NULL,
  precio_litro   numeric(7,3)  NOT NULL,
  con_sancion    boolean       NOT NULL,                                  -- para mostrarlo en el comprobante
  monto          numeric(12,2) NOT NULL
);
CREATE INDEX ix_liq_detalle_liq ON liquidacion_detalle (liquidacion_id);

-- ---------------------------------------------------------------------
-- Pago por recolección
-- ---------------------------------------------------------------------
-- Precio: el de sanción si el productor tiene sanción ese día (precio o bloqueo), si no el normal;
-- ambos según la fecha. Las anuladas no se pagan. Si ya fue liquidada se usa el monto congelado.
--   revisada = el analista ya la confirmó
--   retenida = productor no aprobado, o alerta que retiene el pago sin revisar
--   pagable  = revisada y no retenida
CREATE VIEW v_recoleccion_pago AS
SELECT b.recoleccion_id,
       b.productor_id,
       b.fecha,
       b.litros,
       b.estado_calidad,
       b.con_sancion,
       b.revisada,
       b.retenida,
       (b.revisada AND NOT b.retenida)           AS pagable,
       (ld.recoleccion_id IS NOT NULL)           AS liquidada,
       COALESCE(ld.precio_litro, p.precio_litro) AS precio_litro,
       COALESCE(
         ld.monto,
         CASE WHEN b.estado_calidad = 'alterado'
                   AND (SELECT valor FROM configuracion WHERE clave = 'pagar_leche_alterada') <> 'true'
              THEN 0::numeric
              ELSE round(b.litros * p.precio_litro, 2)
         END
       ) AS monto
FROM (
  SELECT r.id AS recoleccion_id,
         r.productor_id,
         r.litros,
         r.estado_calidad,
         (r.registrada_en AT TIME ZONE 'America/Lima')::date AS fecha,
         fn_en_sancion(r.productor_id, (r.registrada_en AT TIME ZONE 'America/Lima')::date) AS con_sancion,
         (r.calidad_en IS NOT NULL) AS revisada,
         (NOT pr.aprobado
          OR EXISTS (SELECT 1 FROM alerta_recoleccion a
                      WHERE a.recoleccion_id = r.id AND a.revisada_en IS NULL
                        AND a.tipo IN ('productor_bloqueado', 'firma_invalida'))) AS retenida
  FROM recoleccion r
  JOIN productor pr ON pr.id = r.productor_id
  WHERE r.anulada_en IS NULL
) b
CROSS JOIN LATERAL (
  SELECT fn_precio_leche(
           CASE WHEN b.con_sancion THEN 'sancion'::tipo_precio_leche ELSE 'normal'::tipo_precio_leche END,
           b.fecha) AS precio_litro
) p
LEFT JOIN liquidacion_detalle ld ON ld.recoleccion_id = b.recoleccion_id;

-- Reglas de la liquidación (solo lo pagable, del mismo productor y del periodo; nada tras pagarla)
CREATE FUNCTION fn_validar_liquidacion_detalle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_liq  record;
  v_pago record;
BEGIN
  SELECT productor_id, desde, hasta, estado INTO v_liq
    FROM liquidacion_productor WHERE id = NEW.liquidacion_id;
  IF v_liq.estado = 'pagado' THEN
    RAISE EXCEPTION 'La liquidación % ya está pagada', NEW.liquidacion_id;
  END IF;

  SELECT pg.productor_id, pg.fecha, pg.pagable INTO v_pago
    FROM v_recoleccion_pago pg WHERE pg.recoleccion_id = NEW.recoleccion_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La recolección % no existe o está anulada', NEW.recoleccion_id;
  END IF;
  IF v_pago.productor_id <> v_liq.productor_id THEN
    RAISE EXCEPTION 'La recolección % no pertenece al productor de la liquidación', NEW.recoleccion_id;
  END IF;
  IF v_pago.fecha NOT BETWEEN v_liq.desde AND v_liq.hasta THEN
    RAISE EXCEPTION 'La recolección % está fuera del periodo de la liquidación', NEW.recoleccion_id;
  END IF;
  IF NOT v_pago.pagable THEN
    RAISE EXCEPTION 'La recolección % aún no es pagable (falta revisión de calidad o está retenida)', NEW.recoleccion_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_liq_detalle_validar BEFORE INSERT ON liquidacion_detalle
  FOR EACH ROW EXECUTE FUNCTION fn_validar_liquidacion_detalle();

CREATE FUNCTION fn_proteger_liquidacion_pagada() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT estado FROM liquidacion_productor WHERE id = OLD.liquidacion_id) = 'pagado' THEN
    RAISE EXCEPTION 'La liquidación % ya está pagada y no se puede modificar', OLD.liquidacion_id;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_liq_detalle_proteger BEFORE UPDATE OR DELETE ON liquidacion_detalle
  FOR EACH ROW EXECUTE FUNCTION fn_proteger_liquidacion_pagada();

CREATE FUNCTION fn_validar_liquidacion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.estado = 'pagado' AND NOT EXISTS (SELECT 1 FROM liquidacion_detalle WHERE liquidacion_id = NEW.id) THEN
    RAISE EXCEPTION 'No se puede pagar una liquidación sin detalle';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_liq_validar BEFORE UPDATE OF estado ON liquidacion_productor
  FOR EACH ROW EXECUTE FUNCTION fn_validar_liquidacion();

-- Cuentas por pagar a productores: lo pagable ya, y lo que está en espera (sin revisar o retenido)
CREATE VIEW v_pago_pendiente_productor AS
SELECT pg.productor_id,
       p.codigo,
       p.nombre,
       COALESCE(SUM(pg.litros) FILTER (WHERE pg.pagable), 0)     AS litros_pagables,
       COALESCE(SUM(pg.monto)  FILTER (WHERE pg.pagable), 0)     AS monto_pagable,
       COALESCE(SUM(pg.monto)  FILTER (WHERE NOT pg.pagable), 0) AS monto_en_espera,
       MIN(pg.fecha) AS desde,
       MAX(pg.fecha) AS hasta
FROM v_recoleccion_pago pg
JOIN productor p ON p.id = pg.productor_id
WHERE NOT pg.liquidada
GROUP BY pg.productor_id, p.codigo, p.nombre;

-- Liquidación con sus totales (y los datos para el comprobante semanal del productor)
CREATE VIEW v_liquidacion_productor AS
SELECT l.id AS liquidacion_id,
       l.productor_id,
       p.codigo AS productor_codigo,
       p.nombre AS productor,
       l.desde,
       l.hasta,
       l.estado,
       l.pagada_en,
       COUNT(d.recoleccion_id)                                    AS n_recolecciones,
       COALESCE(SUM(d.litros), 0)                                 AS litros,
       COALESCE(SUM(d.monto), 0)                                  AS monto,
       COALESCE(SUM(d.litros) FILTER (WHERE d.con_sancion), 0)    AS litros_con_sancion,
       COALESCE(SUM(round(d.litros * (fn_precio_leche('normal', pg.fecha) - d.precio_litro), 2))
                FILTER (WHERE d.con_sancion), 0)                  AS descuento_sancion
FROM liquidacion_productor l
JOIN productor p ON p.id = l.productor_id
LEFT JOIN liquidacion_detalle d ON d.liquidacion_id = l.id
LEFT JOIN v_recoleccion_pago pg ON pg.recoleccion_id = d.recoleccion_id
GROUP BY l.id, p.codigo, p.nombre;

-- ---------------------------------------------------------------------
-- Estado de los productores y pantallas de calidad
-- ---------------------------------------------------------------------
-- La app del acopiador usa sancionado/bloqueado para pintar el nombre en rojo
-- o impedir el registro del productor bloqueado.
CREATE VIEW v_productor_estado_hoy AS
SELECT p.id AS productor_id,
       COALESCE(bool_or(s.id IS NOT NULL), false)    AS sancionado,
       COALESCE(bool_or(s.tipo = 'bloqueo'), false)  AS bloqueado,
       MAX(s.hasta)                                  AS sancion_hasta
FROM productor p
LEFT JOIN sancion_productor s
       ON s.productor_id = p.id
      AND s.levantada_en IS NULL
      AND (now() AT TIME ZONE 'America/Lima')::date BETWEEN s.desde AND s.hasta
GROUP BY p.id;

-- Resumen por proveedor (pantalla "Proveedores" del admin)
CREATE VIEW v_productor_resumen AS
SELECT p.id AS productor_id,
       p.codigo,
       p.nombre,
       p.tipo,
       p.ruta_id,
       (NOT p.aprobado) AS pendiente_aprobacion,
       u.nombre_completo AS acopiador,
       COALESCE(a.color_hex, (SELECT valor FROM configuracion WHERE clave = 'color_externo')) AS color_hex,
       COALESCE(SUM(r.litros), 0)                                              AS litros_total,
       COALESCE(SUM(r.litros) FILTER (WHERE r.estado_calidad = 'alterado'), 0) AS litros_descartados,
       COUNT(r.id)                AS n_recolecciones,
       MAX(r.registrada_en)       AS ultima_recoleccion,
       e.sancionado,
       e.bloqueado,
       e.sancion_hasta
FROM productor p
JOIN v_productor_estado_hoy e ON e.productor_id = p.id
LEFT JOIN ruta_acopiador ra ON ra.ruta_id = p.ruta_id AND ra.vigente_hasta IS NULL
LEFT JOIN acopiador a       ON a.usuario_id = ra.acopiador_id
LEFT JOIN usuario u         ON u.id = a.usuario_id
LEFT JOIN recoleccion r     ON r.productor_id = p.id AND r.anulada_en IS NULL
GROUP BY p.id, u.nombre_completo, a.color_hex, e.sancionado, e.bloqueado, e.sancion_hasta;

-- Productores observados (tarjeta del dashboard): desde que se marca la alteración
-- hasta que termina su sanción o bloqueo.
--   'inicia_manana' -> la sanción todavía no rige (empieza mañana)
--   'en_sancion'    -> se le paga el precio de sanción
--   'bloqueado'     -> no puede entregar leche
-- recoleccion_origen_id abre el detalle (recolección, análisis y foto).
CREATE VIEW v_productor_observado AS
SELECT DISTINCT ON (s.productor_id)
       s.productor_id,
       p.codigo,
       p.nombre,
       p.tipo,
       p.ruta_id,
       rt.nombre                    AS ruta,
       u.nombre_completo            AS acopiador,
       COALESCE(ac.color_hex, (SELECT valor FROM configuracion WHERE clave = 'color_externo')) AS color_hex,
       s.id                         AS sancion_id,
       s.recoleccion_id             AS recoleccion_origen_id,
       s.tipo                       AS tipo_sancion,
       CASE WHEN s.desde > h.hoy THEN 'inicia_manana'
            WHEN s.tipo = 'bloqueo' THEN 'bloqueado'
            ELSE 'en_sancion' END   AS estado,
       s.desde                      AS sancion_desde,
       s.hasta                      AS sancion_hasta,
       s.hasta - GREATEST(h.hoy, s.desde) + 1 AS dias_restantes,
       fn_precio_leche('sancion', h.hoy)      AS precio_sancion_litro,
       aq.ph,
       aq.temperatura_c,
       aq.grasa_pct,
       aq.densidad,
       aq.antibioticos_positivo,
       aq.foto_url
FROM sancion_productor s
CROSS JOIN (SELECT (now() AT TIME ZONE 'America/Lima')::date AS hoy) h
JOIN productor p            ON p.id = s.productor_id
LEFT JOIN ruta rt           ON rt.id = p.ruta_id
LEFT JOIN ruta_acopiador ra ON ra.ruta_id = p.ruta_id AND ra.vigente_hasta IS NULL
LEFT JOIN acopiador ac      ON ac.usuario_id = ra.acopiador_id
LEFT JOIN usuario u         ON u.id = ac.usuario_id
LEFT JOIN analisis_calidad aq ON aq.recoleccion_id = s.recoleccion_id
WHERE s.levantada_en IS NULL
  AND s.hasta >= h.hoy
ORDER BY s.productor_id, (s.tipo = 'bloqueo') DESC, s.desde DESC;

-- Lista de trabajo del analista: recolecciones que nadie ha revisado todavía
-- (el código del productor es el que lleva el QR del tarro)
CREATE VIEW v_recoleccion_sin_revisar AS
SELECT r.id AS recoleccion_id,
       r.productor_id,
       p.codigo AS productor_codigo,
       p.nombre AS productor,
       r.litros,
       r.registrada_en,
       r.registrado_por
FROM recoleccion r
JOIN productor p ON p.id = r.productor_id
WHERE r.anulada_en IS NULL
  AND r.calidad_en IS NULL;

-- Transparencia del control de calidad: qué porcentaje marca como alterado cada analista
CREATE VIEW v_analista_resumen AS
SELECT u.id AS analista_id,
       u.nombre_completo,
       date_trunc('month', r.calidad_en AT TIME ZONE 'America/Lima')::date AS mes,
       COUNT(*)                                                      AS revisadas,
       COUNT(*) FILTER (WHERE r.estado_calidad = 'alterado')         AS alteradas,
       round(100.0 * COUNT(*) FILTER (WHERE r.estado_calidad = 'alterado') / COUNT(*), 1) AS pct_alteradas
FROM recoleccion r
JOIN usuario u ON u.id = r.calidad_por
WHERE r.anulada_en IS NULL
  AND r.calidad_en IS NOT NULL
GROUP BY u.id, u.nombre_completo, 3;

-- Pantalla central del admin (lista y mapa): cada recolección con quién la hizo (su nombre y color,
-- por registrado_por, no por la ruta actual), calidad, ubicación, alertas y pago.
CREATE VIEW v_recoleccion_detalle AS
SELECT r.id AS recoleccion_id,
       r.registrada_en,
       (r.registrada_en AT TIME ZONE 'America/Lima')::date AS fecha,
       r.productor_id,
       p.codigo                  AS productor_codigo,
       p.nombre                  AS productor,
       p.tipo                    AS tipo_productor,
       (NOT p.aprobado)          AS productor_pendiente,
       r.ruta_id,
       rt.nombre                 AS ruta,
       r.registrado_por,
       u.nombre_completo         AS registrado_por_nombre,
       COALESCE(a.color_hex, (SELECT valor FROM configuracion WHERE clave = 'color_externo')) AS color_hex,
       r.litros,
       r.observacion,
       r.estado_calidad,
       (r.calidad_en IS NOT NULL) AS revisada,
       r.latitud,
       r.longitud,
       r.precision_m,
       r.origen_ubicacion,
       r.ubicacion_simulada,
       (SELECT COUNT(*) FROM alerta_recoleccion al
         WHERE al.recoleccion_id = r.id AND al.revisada_en IS NULL) AS alertas_pendientes,
       pg.monto,
       pg.retenida,
       pg.pagable,
       pg.liquidada,
       r.anulada_en
FROM recoleccion r
JOIN productor p        ON p.id = r.productor_id
JOIN usuario u          ON u.id = r.registrado_por
LEFT JOIN acopiador a   ON a.usuario_id = r.registrado_por
LEFT JOIN ruta rt       ON rt.id = r.ruta_id
LEFT JOIN v_recoleccion_pago pg ON pg.recoleccion_id = r.id;

-- ---------------------------------------------------------------------
-- Insumos e inventario
-- ---------------------------------------------------------------------
CREATE TABLE insumo (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre         text          NOT NULL UNIQUE,
  unidad         unidad_insumo NOT NULL,
  costo_unitario numeric(12,4) NOT NULL DEFAULT 0 CHECK (costo_unitario >= 0),  -- costo promedio ponderado por unidad (lo mantiene el trigger de movimientos)
  activo         boolean       NOT NULL DEFAULT true,
  creado_en      timestamptz   NOT NULL DEFAULT now()
);

-- Recetas: cantidades expresadas para litros_base de leche.
-- Quesos: rendimiento_base en UNIDADES. Yogurt: en KILOS.
-- dias_vida_util: días que dura el producto desde su producción (NULL = sin control de vencimiento).
CREATE TABLE receta (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre           text          NOT NULL UNIQUE,
  unidad_venta     unidad_venta  NOT NULL,
  precio_venta     numeric(10,2) CHECK (precio_venta >= 0),
  litros_base      numeric(8,2)  NOT NULL DEFAULT 100 CHECK (litros_base > 0),
  rendimiento_base numeric(10,2) CHECK (rendimiento_base > 0),  -- unidades o kg que salen de litros_base (lo define el cliente)
  dias_vida_util   int           CHECK (dias_vida_util > 0),
  activa           boolean       NOT NULL DEFAULT true,
  actualizado_en   timestamptz   NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_receta_act BEFORE UPDATE ON receta
  FOR EACH ROW EXECUTE FUNCTION fn_actualizado_en();

CREATE TABLE receta_insumo (
  receta_id bigint        NOT NULL REFERENCES receta (id) ON DELETE CASCADE,
  insumo_id bigint        NOT NULL REFERENCES insumo (id),
  cantidad  numeric(12,3) NOT NULL CHECK (cantidad > 0),   -- en la unidad del insumo, por litros_base
  PRIMARY KEY (receta_id, insumo_id)
);

-- ---------------------------------------------------------------------
-- Producción por lotes
-- ---------------------------------------------------------------------
-- Flujo: crear lote (en_proceso) -> asignarle leche de jornadas (lote_leche) -> consumir insumos
-- -> registrar costos propios -> CERRAR con cantidad_producida. Cerrado, no se altera.
-- Los litros y el costo de la leche salen de lote_leche (no se repiten aquí).
CREATE TABLE lote_produccion (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo             text         NOT NULL UNIQUE,           -- ej. L-2026-0001
  receta_id          bigint       NOT NULL REFERENCES receta (id),
  fecha_produccion   date         NOT NULL DEFAULT current_date,
  cantidad_producida numeric(10,2) CHECK (cantidad_producida >= 0),           -- rendimiento real, en unidad_venta de la receta
  estado             estado_lote  NOT NULL DEFAULT 'en_proceso',
  creado_por         bigint       NOT NULL REFERENCES usuario (id),
  creado_en          timestamptz  NOT NULL DEFAULT now(),
  cerrado_en         timestamptz,
  CONSTRAINT ck_lote_cerrado CHECK (estado = 'en_proceso' OR (cantidad_producida IS NOT NULL AND cerrado_en IS NOT NULL))
);
CREATE INDEX ix_lote_fecha ON lote_produccion (fecha_produccion DESC);

CREATE FUNCTION fn_lote_abierto(p_lote bigint) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT estado = 'en_proceso' FROM lote_produccion WHERE id = p_lote;
$$;

-- Leche que consume cada lote, por jornada de recolección. costo_litro es el costo por litro útil
-- de esa jornada al momento de asignarla (lo fija el trigger): incluye lo pagado por leche descartada.
CREATE TABLE lote_leche (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lote_id     bigint        NOT NULL REFERENCES lote_produccion (id),
  fecha       date          NOT NULL,                    -- jornada de recolección de esa leche
  litros      numeric(10,2) NOT NULL CHECK (litros > 0),
  costo_litro numeric(10,4) NOT NULL,
  costo       numeric(12,2) GENERATED ALWAYS AS (round(litros * costo_litro, 2)) STORED,
  CONSTRAINT uq_lote_leche UNIQUE (lote_id, fecha)
);
CREATE INDEX ix_lote_leche_fecha ON lote_leche (fecha);

-- Costos propios de un lote: electricidad, mano de obra, etc.
-- OJO: lo que se asigna aquí NO se vuelve a registrar en gasto_operativo (se duplicaría).
CREATE TABLE lote_costo (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lote_id     bigint         NOT NULL REFERENCES lote_produccion (id) ON DELETE CASCADE,
  concepto    concepto_costo NOT NULL,
  descripcion text,
  monto       numeric(12,2)  NOT NULL CHECK (monto >= 0)
);
CREATE INDEX ix_lote_costo_lote ON lote_costo (lote_id);

CREATE FUNCTION fn_exigir_lote_abierto() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_lote bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN v_lote := OLD.lote_id; ELSE v_lote := NEW.lote_id; END IF;
  IF NOT COALESCE(fn_lote_abierto(v_lote), false) THEN
    RAISE EXCEPTION 'El lote % está cerrado: no se pueden cambiar sus costos', v_lote;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_lote_costo_abierto BEFORE INSERT OR UPDATE OR DELETE ON lote_costo
  FOR EACH ROW EXECUTE FUNCTION fn_exigir_lote_abierto();

-- Movimientos de inventario: única fuente de verdad del stock.
-- cantidad con signo: ingresos (+), consumo de lote (−), ajuste (±).
-- Ingresos y stock inicial REQUIEREN costo_unitario (> 0): sin eso la ganancia sale inflada.
CREATE TABLE movimiento_insumo (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  insumo_id      bigint          NOT NULL REFERENCES insumo (id),
  tipo           tipo_mov_insumo NOT NULL,
  cantidad       numeric(12,3)   NOT NULL,
  costo_unitario numeric(12,4)   NOT NULL DEFAULT 0 CHECK (costo_unitario >= 0),
  lote_id        bigint          REFERENCES lote_produccion (id),
  usuario_id     bigint          NOT NULL REFERENCES usuario (id),
  fecha          timestamptz     NOT NULL DEFAULT now(),
  nota           text,
  CONSTRAINT ck_mov_signo CHECK (
    (tipo IN ('stock_inicial', 'ingreso') AND cantidad > 0)
    OR (tipo = 'consumo_lote' AND cantidad < 0 AND lote_id IS NOT NULL)
    OR (tipo = 'ajuste' AND cantidad <> 0)
  ),
  CONSTRAINT ck_mov_costo CHECK (tipo NOT IN ('stock_inicial', 'ingreso') OR costo_unitario > 0)
);
CREATE INDEX ix_mov_insumo ON movimiento_insumo (insumo_id, fecha DESC);
CREATE INDEX ix_mov_lote   ON movimiento_insumo (lote_id) WHERE lote_id IS NOT NULL;

-- Bloquea el insumo, impide stock negativo, mantiene el costo promedio ponderado,
-- fija el costo de cada consumo al promedio vigente y solo consume en lotes abiertos.
CREATE FUNCTION fn_movimiento_insumo() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_stock numeric;
  v_costo numeric;
BEGIN
  SELECT costo_unitario INTO v_costo FROM insumo WHERE id = NEW.insumo_id FOR UPDATE;
  SELECT COALESCE(SUM(cantidad), 0) INTO v_stock FROM movimiento_insumo WHERE insumo_id = NEW.insumo_id;

  IF v_stock + NEW.cantidad < 0 THEN
    RAISE EXCEPTION 'Stock insuficiente del insumo %', NEW.insumo_id;
  END IF;

  IF NEW.tipo = 'consumo_lote' THEN
    IF NOT COALESCE(fn_lote_abierto(NEW.lote_id), false) THEN
      RAISE EXCEPTION 'El lote % está cerrado: no se puede consumir más insumo', NEW.lote_id;
    END IF;
    NEW.costo_unitario := v_costo;
  ELSIF NEW.tipo IN ('stock_inicial', 'ingreso') THEN
    UPDATE insumo
       SET costo_unitario = round(
             (GREATEST(v_stock, 0) * v_costo + NEW.cantidad * NEW.costo_unitario)
             / (GREATEST(v_stock, 0) + NEW.cantidad), 4)
     WHERE id = NEW.insumo_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_mov_insumo BEFORE INSERT ON movimiento_insumo
  FOR EACH ROW EXECUTE FUNCTION fn_movimiento_insumo();

CREATE VIEW v_insumo_stock AS
SELECT i.id AS insumo_id,
       i.nombre,
       i.unidad,
       COALESCE(SUM(m.cantidad), 0) AS stock,
       CASE WHEN COALESCE(SUM(m.cantidad), 0) > 0 THEN 'disponible' ELSE 'sin_stock' END AS estado,
       i.costo_unitario,
       MAX(m.fecha) FILTER (WHERE m.tipo IN ('stock_inicial', 'ingreso', 'ajuste')) AS ultima_actualizacion
FROM insumo i
LEFT JOIN movimiento_insumo m ON m.insumo_id = i.id
WHERE i.activo
GROUP BY i.id;

-- ---------------------------------------------------------------------
-- Leche por jornada: aprobada, usada, merma y costo por litro útil
-- ---------------------------------------------------------------------
-- Nota: costo_pagado incluye la leche retenida (ya se recibió y se usa; su pago solo está en espera).
--       v_flujo_mensual, en cambio, es caja y no cuenta lo retenido hasta que se libere.
-- La leche es perecible: se trabaja POR JORNADA, no como un stock acumulado.
-- Pérdidas de leche en planta (derrame, se agrió, diferencia de medición, sobrante sin destino...)
CREATE TABLE merma_leche (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fecha          date          NOT NULL,                  -- jornada de recolección de la leche perdida
  litros         numeric(8,2)  NOT NULL CHECK (litros > 0),
  motivo         text          NOT NULL,
  registrado_por bigint        NOT NULL REFERENCES usuario (id),
  creado_en      timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX ix_merma_leche_fecha ON merma_leche (fecha);

-- Leche aprobada de una jornada que aún no tiene lote ni merma.
-- Aprobada = normal + ya revisada por el analista + no anulada.
CREATE FUNCTION fn_leche_disponible(p_fecha date, p_excluir_lote_leche bigint DEFAULT NULL, p_excluir_merma bigint DEFAULT NULL)
RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT SUM(r.litros) FROM recoleccion r
                    WHERE r.anulada_en IS NULL AND r.estado_calidad = 'normal' AND r.calidad_en IS NOT NULL
                      AND r.registrada_en >= (p_fecha::timestamp AT TIME ZONE 'America/Lima')
                      AND r.registrada_en <  ((p_fecha + 1)::timestamp AT TIME ZONE 'America/Lima')), 0)
       - COALESCE((SELECT SUM(l.litros) FROM lote_leche l
                    WHERE l.fecha = p_fecha AND l.id IS DISTINCT FROM p_excluir_lote_leche), 0)
       - COALESCE((SELECT SUM(m.litros) FROM merma_leche m
                    WHERE m.fecha = p_fecha AND m.id IS DISTINCT FROM p_excluir_merma), 0);
$$;

CREATE VIEW v_leche_jornada AS
SELECT r.fecha,
       r.litros_recolectados,
       r.litros_descartados,
       r.litros_por_revisar,
       r.litros_aprobados,
       COALESCE(u.litros, 0) AS litros_usados,
       COALESCE(m.litros, 0) AS litros_merma,
       r.litros_aprobados - COALESCE(u.litros, 0) - COALESCE(m.litros, 0) AS litros_disponibles,
       COALESCE(p.monto, 0)  AS costo_pagado,
       -- todo lo pagado ese día (incluida la leche descartada) repartido entre los litros útiles
       round(COALESCE(p.monto, 0) / NULLIF(r.litros_aprobados, 0), 4) AS costo_litro_util,
       h.hoy - r.fecha AS dias_antiguedad,
       (r.litros_aprobados - COALESCE(u.litros, 0) - COALESCE(m.litros, 0) > 0
        AND h.hoy - r.fecha > (SELECT valor::int FROM configuracion WHERE clave = 'dias_max_leche')) AS sin_destino
FROM (
  SELECT (registrada_en AT TIME ZONE 'America/Lima')::date AS fecha,
         SUM(litros) AS litros_recolectados,
         COALESCE(SUM(litros) FILTER (WHERE estado_calidad = 'alterado'), 0) AS litros_descartados,
         COALESCE(SUM(litros) FILTER (WHERE estado_calidad = 'normal' AND calidad_en IS NULL), 0) AS litros_por_revisar,
         COALESCE(SUM(litros) FILTER (WHERE estado_calidad = 'normal' AND calidad_en IS NOT NULL), 0) AS litros_aprobados
  FROM recoleccion
  WHERE anulada_en IS NULL
  GROUP BY 1
) r
CROSS JOIN (SELECT (now() AT TIME ZONE 'America/Lima')::date AS hoy) h
LEFT JOIN (SELECT fecha, SUM(litros) AS litros FROM lote_leche GROUP BY fecha) u ON u.fecha = r.fecha
LEFT JOIN (SELECT fecha, SUM(litros) AS litros FROM merma_leche GROUP BY fecha) m ON m.fecha = r.fecha
LEFT JOIN (SELECT fecha, SUM(monto) AS monto FROM v_recoleccion_pago GROUP BY fecha) p ON p.fecha = r.fecha;

CREATE FUNCTION fn_costo_litro_jornada(p_fecha date) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT costo_litro_util FROM v_leche_jornada WHERE fecha = p_fecha;
$$;

-- No se asigna a un lote más leche de la que hay aprobada en esa jornada; el costo se fija al asignarla;
-- un lote cerrado no cambia.
CREATE FUNCTION fn_lote_leche() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_lote bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN v_lote := OLD.lote_id; ELSE v_lote := NEW.lote_id; END IF;
  IF NOT COALESCE(fn_lote_abierto(v_lote), false) THEN
    RAISE EXCEPTION 'El lote % está cerrado: no se puede cambiar su leche', v_lote;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  IF TG_OP = 'UPDATE' AND (NEW.lote_id <> OLD.lote_id OR NEW.fecha <> OLD.fecha) THEN
    RAISE EXCEPTION 'No se puede cambiar el lote ni la jornada de la leche asignada; elimine y vuelva a asignar';
  END IF;

  PERFORM pg_advisory_xact_lock(NEW.fecha - DATE '2000-01-01');
  IF fn_leche_disponible(NEW.fecha, CASE WHEN TG_OP = 'UPDATE' THEN OLD.id END, NULL) < NEW.litros THEN
    RAISE EXCEPTION 'Leche aprobada insuficiente en la jornada % (falta revisión de calidad o ya fue asignada)', NEW.fecha;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.costo_litro := COALESCE(fn_costo_litro_jornada(NEW.fecha), 0);
  ELSE
    NEW.costo_litro := OLD.costo_litro;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_lote_leche BEFORE INSERT OR UPDATE OR DELETE ON lote_leche
  FOR EACH ROW EXECUTE FUNCTION fn_lote_leche();

CREATE FUNCTION fn_merma_leche() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(NEW.fecha - DATE '2000-01-01');
  IF fn_leche_disponible(NEW.fecha, NULL, CASE WHEN TG_OP = 'UPDATE' THEN OLD.id END) < NEW.litros THEN
    RAISE EXCEPTION 'La merma supera la leche aprobada sin destino de la jornada %', NEW.fecha;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_merma_leche BEFORE INSERT OR UPDATE ON merma_leche
  FOR EACH ROW EXECUTE FUNCTION fn_merma_leche();

-- Resumen para el dashboard. litros_sin_destino = leche aprobada que pasó el plazo (dias_max_leche)
-- sin lote: hay que registrar su merma. costo_descartado = lo pagado por leche alterada.
CREATE VIEW v_leche_stock AS
SELECT COALESCE(SUM(litros_disponibles), 0)                                  AS litros_disponibles,
       COALESCE(SUM(litros_disponibles) FILTER (WHERE sin_destino), 0)       AS litros_sin_destino,
       COALESCE(SUM(litros_por_revisar), 0)                                  AS litros_por_revisar,
       COALESCE(SUM(litros_descartados), 0)                                  AS litros_descartados,
       COALESCE(SUM(litros_usados), 0)                                       AS litros_usados,
       COALESCE(SUM(litros_merma), 0)                                        AS litros_merma,
       (SELECT COALESCE(SUM(monto), 0) FROM v_recoleccion_pago
         WHERE estado_calidad = 'alterado')                              AS costo_descartado
FROM v_leche_jornada;

-- ---------------------------------------------------------------------
-- Cierre y reapertura de lotes
-- ---------------------------------------------------------------------
-- Para cerrar el lote debe tener leche asignada. Un lote con ventas o bajas no se reabre ni puede
-- quedar con menos producción que lo ya vendido o dado de baja.
CREATE FUNCTION fn_validar_lote() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_salido numeric;
BEGIN
  SELECT COALESCE((SELECT SUM(cantidad) FROM venta_detalle WHERE lote_id = NEW.id), 0)
       + COALESCE((SELECT SUM(cantidad) FROM baja_producto WHERE lote_id = NEW.id), 0)
    INTO v_salido;

  IF NEW.estado = 'cerrado' AND OLD.estado = 'en_proceso'
     AND NOT EXISTS (SELECT 1 FROM lote_leche WHERE lote_id = NEW.id) THEN
    RAISE EXCEPTION 'El lote % no tiene leche asignada', NEW.id;
  END IF;
  IF OLD.estado = 'cerrado' AND NEW.estado = 'en_proceso' AND v_salido > 0 THEN
    RAISE EXCEPTION 'No se puede reabrir el lote %: ya tiene ventas o bajas', NEW.id;
  END IF;
  IF NEW.estado = 'cerrado' AND NEW.cantidad_producida < v_salido THEN
    RAISE EXCEPTION 'La producción del lote % no puede ser menor que lo ya vendido o dado de baja (%)', NEW.id, v_salido;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_lote_validar BEFORE UPDATE ON lote_produccion
  FOR EACH ROW EXECUTE FUNCTION fn_validar_lote();

-- ---------------------------------------------------------------------
-- Ventas (todas al contado: no hay crédito ni cuentas por cobrar)
-- Son notas de venta internas; no son comprobantes electrónicos de SUNAT.
-- ---------------------------------------------------------------------
CREATE TABLE cliente (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre    text         NOT NULL,                 -- empresa o persona natural
  tipo      tipo_persona NOT NULL DEFAULT 'natural',
  documento varchar(11),
  celular   varchar(9),
  creado_en timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT ck_cliente_documento CHECK (documento ~ '^[0-9]{8}([0-9]{3})?$'),
  CONSTRAINT ck_cliente_celular   CHECK (celular ~ '^[0-9]{9}$')
);

CREATE TABLE venta (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cliente_id     bigint      NOT NULL REFERENCES cliente (id),
  fecha          date        NOT NULL DEFAULT current_date,
  registrada_por bigint      NOT NULL REFERENCES usuario (id),
  observacion    text,
  creado_en      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_venta_fecha ON venta (fecha DESC);

CREATE TABLE venta_detalle (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  venta_id        bigint        NOT NULL REFERENCES venta (id) ON DELETE CASCADE,
  lote_id         bigint        NOT NULL REFERENCES lote_produccion (id),
  cantidad        numeric(10,2) NOT NULL CHECK (cantidad > 0),
  precio_unitario numeric(10,2) NOT NULL CHECK (precio_unitario >= 0),
  subtotal        numeric(12,2) GENERATED ALWAYS AS (round(cantidad * precio_unitario, 2)) STORED
);
CREATE INDEX ix_venta_detalle_lote  ON venta_detalle (lote_id);
CREATE INDEX ix_venta_detalle_venta ON venta_detalle (venta_id);

-- Mermas, vencimientos y muestras del producto terminado
CREATE TABLE baja_producto (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lote_id        bigint        NOT NULL REFERENCES lote_produccion (id),
  cantidad       numeric(10,2) NOT NULL CHECK (cantidad > 0),
  motivo         motivo_baja   NOT NULL,
  fecha          date          NOT NULL DEFAULT current_date,
  nota           text,
  registrado_por bigint        NOT NULL REFERENCES usuario (id),
  creado_en      timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX ix_baja_lote ON baja_producto (lote_id);

-- Saldo disponible del lote = producido − vendido − bajas
CREATE FUNCTION fn_saldo_lote(p_lote bigint, p_excluir_detalle bigint DEFAULT NULL, p_excluir_baja bigint DEFAULT NULL)
RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(l.cantidad_producida, 0)
         - COALESCE((SELECT SUM(d.cantidad) FROM venta_detalle d
                      WHERE d.lote_id = p_lote AND d.id IS DISTINCT FROM p_excluir_detalle), 0)
         - COALESCE((SELECT SUM(b.cantidad) FROM baja_producto b
                      WHERE b.lote_id = p_lote AND b.id IS DISTINCT FROM p_excluir_baja), 0)
  FROM lote_produccion l
  WHERE l.id = p_lote;
$$;

-- No se vende ni se da de baja más de lo que queda, y solo de lotes cerrados.
-- Una venta no puede ser anterior a la producción ni de un lote vencido (se da de baja por 'vencido').
CREATE FUNCTION fn_validar_saldo_lote() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_estado  estado_lote;
  v_prod    date;
  v_vida    int;
  v_venta   date;
BEGIN
  SELECT l.estado, l.fecha_produccion, r.dias_vida_util INTO v_estado, v_prod, v_vida
    FROM lote_produccion l JOIN receta r ON r.id = l.receta_id
   WHERE l.id = NEW.lote_id FOR UPDATE OF l;
  IF v_estado IS DISTINCT FROM 'cerrado' THEN
    RAISE EXCEPTION 'El lote % no está cerrado', NEW.lote_id;
  END IF;

  IF TG_TABLE_NAME = 'venta_detalle' THEN
    SELECT fecha INTO v_venta FROM venta WHERE id = NEW.venta_id;
    IF v_venta < v_prod THEN
      RAISE EXCEPTION 'La venta no puede ser anterior a la producción del lote %', NEW.lote_id;
    END IF;
    IF v_vida IS NOT NULL AND v_venta > v_prod + v_vida THEN
      RAISE EXCEPTION 'El lote % está vencido: registre su baja por vencimiento', NEW.lote_id;
    END IF;
    IF fn_saldo_lote(NEW.lote_id, NEW.id, NULL) < NEW.cantidad THEN
      RAISE EXCEPTION 'Saldo insuficiente en el lote %', NEW.lote_id;
    END IF;
  ELSE
    IF fn_saldo_lote(NEW.lote_id, NULL, NEW.id) < NEW.cantidad THEN
      RAISE EXCEPTION 'Saldo insuficiente en el lote %', NEW.lote_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_venta_saldo BEFORE INSERT OR UPDATE ON venta_detalle
  FOR EACH ROW EXECUTE FUNCTION fn_validar_saldo_lote();
CREATE TRIGGER trg_baja_saldo BEFORE INSERT OR UPDATE ON baja_producto
  FOR EACH ROW EXECUTE FUNCTION fn_validar_saldo_lote();

-- ---------------------------------------------------------------------
-- Gastos generales y sueldos de acopiadores
-- ---------------------------------------------------------------------
CREATE TABLE categoria_gasto (
  id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre text NOT NULL UNIQUE
);
INSERT INTO categoria_gasto (nombre) VALUES
  ('Combustible'), ('Sueldo acopiador'), ('Servicios (luz, agua)'),
  ('Alquiler'), ('Empaque y etiquetas'), ('Mantenimiento'), ('Otros');

-- Gastos que NO pertenecen a un lote (los de un lote van en lote_costo).
-- acopiador_id permite saber cuánto cuesta cada ruta (combustible, sueldo).
CREATE TABLE gasto_operativo (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fecha          date          NOT NULL DEFAULT current_date,
  categoria_id   bigint        NOT NULL REFERENCES categoria_gasto (id),
  descripcion    text,
  monto          numeric(12,2) NOT NULL CHECK (monto > 0),
  acopiador_id   bigint        REFERENCES acopiador (usuario_id),
  registrado_por bigint        NOT NULL REFERENCES usuario (id),
  creado_en      timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX ix_gasto_fecha ON gasto_operativo (fecha DESC);

-- Pago mensual al acopiador. Al pagarse genera su gasto_operativo (categoría 'Sueldo acopiador').
-- El sueldo estimado sale de v_acopiador_mes; aquí queda el monto real acordado/pagado.
CREATE TABLE pago_acopiador (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  acopiador_id bigint        NOT NULL REFERENCES acopiador (usuario_id),
  mes          date          NOT NULL,                       -- primer día del mes
  litros_mes   numeric(12,2) NOT NULL,
  sueldo_base  numeric(10,2) NOT NULL CHECK (sueldo_base >= 0),
  comision     numeric(10,2) NOT NULL DEFAULT 0 CHECK (comision >= 0),
  ajustes      numeric(10,2) NOT NULL DEFAULT 0,             -- bonos (+) o descuentos (−)
  total        numeric(10,2) GENERATED ALWAYS AS (sueldo_base + comision + ajustes) STORED,
  estado       estado_pago   NOT NULL DEFAULT 'pendiente',
  pagado_en    timestamptz,
  gasto_id     bigint        REFERENCES gasto_operativo (id),
  nota         text,
  creado_por   bigint        NOT NULL REFERENCES usuario (id),
  creado_en    timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT uq_pago_acopiador_mes UNIQUE (acopiador_id, mes),
  CONSTRAINT ck_pago_acopiador_mes CHECK (EXTRACT(day FROM mes) = 1),
  CONSTRAINT ck_pago_acopiador_estado CHECK ((estado = 'pagado') = (pagado_en IS NOT NULL AND gasto_id IS NOT NULL))
);

-- Sueldo estimado del mes: base + comisión por litro. Por defecto la comisión cuenta solo litros
-- normales (configuracion.comision_incluye_descartada). Las anuladas no cuentan.
CREATE VIEW v_acopiador_mes AS
SELECT a.usuario_id AS acopiador_id,
       u.nombre_completo,
       a.vehiculo,
       m.mes,
       m.litros,
       m.litros_normales,
       m.recolecciones,
       a.sueldo_base_mensual,
       round(CASE WHEN (SELECT valor FROM configuracion WHERE clave = 'comision_incluye_descartada') = 'true'
                  THEN m.litros ELSE m.litros_normales END * a.comision_por_litro, 2) AS comision_estimada,
       a.sueldo_base_mensual
         + round(CASE WHEN (SELECT valor FROM configuracion WHERE clave = 'comision_incluye_descartada') = 'true'
                      THEN m.litros ELSE m.litros_normales END * a.comision_por_litro, 2) AS sueldo_estimado
FROM acopiador a
JOIN usuario u ON u.id = a.usuario_id
JOIN (
  SELECT r.registrado_por,
         date_trunc('month', r.registrada_en AT TIME ZONE 'America/Lima')::date AS mes,
         SUM(r.litros)                                                 AS litros,
         COALESCE(SUM(r.litros) FILTER (WHERE r.estado_calidad = 'normal'), 0) AS litros_normales,
         COUNT(*)                                                      AS recolecciones
  FROM recoleccion r
  WHERE r.anulada_en IS NULL
  GROUP BY 1, 2
) m ON m.registrado_por = a.usuario_id;

-- ---------------------------------------------------------------------
-- Cuenta contable por lote (base de la hoja de costos del lote y del dashboard)
-- ---------------------------------------------------------------------
-- costo_vendido = costo por unidad × unidades vendidas; utilidad_realizada = ingresos − costo_vendido.
-- rendimiento_teorico = litros / litros_base × rendimiento_base de la receta; la desviación mide
-- cuánto se apartó el rendimiento real (mermas, receta, medición).
-- Los gastos generales no se reparten aquí: están en v_resultado_mensual.
CREATE VIEW v_lote_resumen AS
SELECT x.lote_id,
       x.codigo,
       x.receta_id,
       x.receta,
       x.fecha_produccion,
       x.estado,
       x.litros_leche,
       x.cantidad_producida,
       x.cantidad_vendida,
       x.cantidad_baja,
       x.saldo,
       x.ingresos,
       x.costo_leche,
       x.costo_insumos,
       x.costo_electricidad,
       x.costo_mano_obra,
       x.costo_otros,
       x.costo_total,
       round(x.costo_total / NULLIF(x.cantidad_producida, 0), 2)                           AS costo_por_unidad,
       round(x.cantidad_vendida * x.costo_total / NULLIF(x.cantidad_producida, 0), 2)      AS costo_vendido,
       x.ingresos - round(x.cantidad_vendida * x.costo_total / NULLIF(x.cantidad_producida, 0), 2) AS utilidad_realizada,
       CASE WHEN x.rendimiento_base IS NOT NULL AND x.litros_leche > 0
            THEN round(x.litros_leche / x.litros_base * x.rendimiento_base, 2) END         AS rendimiento_teorico,
       CASE WHEN x.rendimiento_base IS NOT NULL AND x.litros_leche > 0 AND x.cantidad_producida > 0
            THEN round((x.cantidad_producida / (x.litros_leche / x.litros_base * x.rendimiento_base) - 1) * 100, 1)
       END                                                                                 AS desviacion_rendimiento_pct,
       x.fecha_produccion + x.dias_vida_util                                               AS fecha_vencimiento,
       (x.fecha_produccion + x.dias_vida_util) - (now() AT TIME ZONE 'America/Lima')::date AS dias_para_vencer
FROM (
  SELECT l.id AS lote_id,
         l.codigo,
         l.receta_id,
         rc.nombre AS receta,
         l.fecha_produccion,
         l.estado,
         COALESCE(lt.litros, 0)                      AS litros_leche,
         COALESCE(l.cantidad_producida, 0)           AS cantidad_producida,
         COALESCE(v.vendido, 0)                      AS cantidad_vendida,
         COALESCE(bj.bajas, 0)                       AS cantidad_baja,
         COALESCE(l.cantidad_producida, 0) - COALESCE(v.vendido, 0) - COALESCE(bj.bajas, 0) AS saldo,
         COALESCE(v.ingresos, 0)                     AS ingresos,
         COALESCE(lt.costo, 0)                       AS costo_leche,
         COALESCE(i.costo, 0)                        AS costo_insumos,
         COALESCE(c.electricidad, 0)                 AS costo_electricidad,
         COALESCE(c.mano_obra, 0)                    AS costo_mano_obra,
         COALESCE(c.otros, 0)                        AS costo_otros,
         COALESCE(lt.costo, 0) + COALESCE(i.costo, 0) + COALESCE(c.total, 0) AS costo_total,
         rc.litros_base,
         rc.rendimiento_base,
         rc.dias_vida_util
  FROM lote_produccion l
  JOIN receta rc ON rc.id = l.receta_id
  LEFT JOIN (
    SELECT lote_id, SUM(litros) AS litros, SUM(costo) AS costo
    FROM lote_leche GROUP BY lote_id
  ) lt ON lt.lote_id = l.id
  LEFT JOIN (
    SELECT lote_id, SUM(cantidad) AS vendido, SUM(subtotal) AS ingresos
    FROM venta_detalle GROUP BY lote_id
  ) v ON v.lote_id = l.id
  LEFT JOIN (
    SELECT lote_id, SUM(cantidad) AS bajas
    FROM baja_producto GROUP BY lote_id
  ) bj ON bj.lote_id = l.id
  LEFT JOIN (
    SELECT lote_id, SUM(-cantidad * costo_unitario) AS costo
    FROM movimiento_insumo WHERE tipo = 'consumo_lote' GROUP BY lote_id
  ) i ON i.lote_id = l.id
  LEFT JOIN (
    SELECT lote_id,
           SUM(monto) AS total,
           SUM(monto) FILTER (WHERE concepto = 'electricidad') AS electricidad,
           SUM(monto) FILTER (WHERE concepto = 'mano_obra')    AS mano_obra,
           SUM(monto) FILTER (WHERE concepto IN ('combustible', 'otro')) AS otros
    FROM lote_costo GROUP BY lote_id
  ) c ON c.lote_id = l.id
) x;

-- Producto terminado disponible para vender, el que vence primero arriba (FIFO).
-- por_vencer: faltan dias_alerta_vencimiento días o menos; vencido: hay que registrar su baja.
CREATE VIEW v_lote_disponible AS
SELECT r.lote_id,
       r.codigo,
       r.receta,
       r.fecha_produccion,
       r.saldo,
       r.fecha_vencimiento,
       r.dias_para_vencer,
       COALESCE(r.dias_para_vencer < 0, false) AS vencido,
       COALESCE(r.dias_para_vencer BETWEEN 0 AND
                (SELECT valor::int FROM configuracion WHERE clave = 'dias_alerta_vencimiento'), false) AS por_vencer
FROM v_lote_resumen r
WHERE r.estado = 'cerrado'
  AND r.saldo > 0
ORDER BY r.fecha_vencimiento NULLS LAST, r.fecha_produccion;

-- ---------------------------------------------------------------------
-- Dos mirada del dinero, claramente separadas
-- ---------------------------------------------------------------------
-- 1) FLUJO DE CAJA mensual: lo que entró y todo lo que se invirtió en el mes.
--    Puede dar negativo al inicio porque se invierte antes de vender.
--      ingresos        = ventas del mes
--      egreso_leche    = pago a productores por las recolecciones del mes (sin las retenidas)
--      egreso_insumos  = compras de insumos del mes
--      egreso_lotes    = electricidad, mano de obra, etc. asignados a lotes del mes
--      egreso_operativo= gastos generales (sueldos de acopiadores, combustible, alquiler...)
CREATE VIEW v_flujo_mensual AS
SELECT mes,
       SUM(ingresos)         AS ingresos,
       SUM(egreso_leche)     AS egreso_leche,
       SUM(egreso_insumos)   AS egreso_insumos,
       SUM(egreso_lotes)     AS egreso_lotes,
       SUM(egreso_operativo) AS egreso_operativo,
       SUM(egreso_leche + egreso_insumos + egreso_lotes + egreso_operativo)            AS total_invertido,
       SUM(ingresos - egreso_leche - egreso_insumos - egreso_lotes - egreso_operativo) AS saldo_caja
FROM (
  SELECT date_trunc('month', v.fecha::timestamp)::date AS mes,
         SUM(d.subtotal) AS ingresos,
         0::numeric AS egreso_leche, 0::numeric AS egreso_insumos,
         0::numeric AS egreso_lotes, 0::numeric AS egreso_operativo
  FROM venta v JOIN venta_detalle d ON d.venta_id = v.id
  GROUP BY 1
  UNION ALL
  SELECT date_trunc('month', fecha::timestamp)::date, 0, SUM(monto), 0, 0, 0
  FROM v_recoleccion_pago WHERE NOT retenida GROUP BY 1
  UNION ALL
  SELECT date_trunc('month', (fecha AT TIME ZONE 'America/Lima'))::date, 0, 0, SUM(cantidad * costo_unitario), 0, 0
  FROM movimiento_insumo WHERE tipo IN ('stock_inicial', 'ingreso') GROUP BY 1
  UNION ALL
  SELECT date_trunc('month', l.fecha_produccion::timestamp)::date, 0, 0, 0, SUM(c.monto), 0
  FROM lote_costo c JOIN lote_produccion l ON l.id = c.lote_id GROUP BY 1
  UNION ALL
  SELECT date_trunc('month', fecha::timestamp)::date, 0, 0, 0, 0, SUM(monto)
  FROM gasto_operativo GROUP BY 1
) x
GROUP BY mes;

-- 2) RESULTADO (ganancia neta real) mensual: lo que realmente se ganó.
--      utilidad = ventas − costo de lo vendido − pérdidas − gastos operativos
--    El inventario sin vender no cuenta como gasto. Lo pagado por leche descartada ya va dentro del
--    costo de la leche buena (costo_litro_util), así que no se resta dos veces; solo se pierde cuando
--    ninguna leche útil lo absorbe (jornada sin leche aprobada) o cuando la leche útil se mermó.
--      perdida_producto = bajas (muestras, vencidos, mermas) al costo del lote
--      perdida_leche    = merma de leche al costo por litro útil + jornadas sin leche aprobada
CREATE VIEW v_resultado_mensual AS
SELECT mes,
       SUM(ingresos)         AS ingresos,
       SUM(costo_ventas)     AS costo_ventas,
       SUM(perdida_producto) AS perdida_producto,
       SUM(perdida_leche)    AS perdida_leche,
       SUM(gasto_operativo)  AS gasto_operativo,
       SUM(ingresos - costo_ventas - perdida_producto - perdida_leche - gasto_operativo) AS utilidad_neta
FROM (
  SELECT date_trunc('month', v.fecha::timestamp)::date AS mes,
         SUM(d.subtotal) AS ingresos,
         COALESCE(SUM(d.cantidad * r.costo_total / NULLIF(r.cantidad_producida, 0)), 0) AS costo_ventas,
         0::numeric AS perdida_producto, 0::numeric AS perdida_leche, 0::numeric AS gasto_operativo
  FROM venta v
  JOIN venta_detalle d  ON d.venta_id = v.id
  JOIN v_lote_resumen r ON r.lote_id = d.lote_id
  GROUP BY 1
  UNION ALL
  SELECT date_trunc('month', b.fecha::timestamp)::date, 0, 0,
         COALESCE(SUM(b.cantidad * r.costo_total / NULLIF(r.cantidad_producida, 0)), 0), 0, 0
  FROM baja_producto b JOIN v_lote_resumen r ON r.lote_id = b.lote_id
  GROUP BY 1
  UNION ALL
  SELECT date_trunc('month', m.fecha::timestamp)::date, 0, 0, 0,
         COALESCE(SUM(m.litros * j.costo_litro_util), 0), 0
  FROM merma_leche m JOIN v_leche_jornada j ON j.fecha = m.fecha
  GROUP BY 1
  UNION ALL
  SELECT date_trunc('month', fecha::timestamp)::date, 0, 0, 0, SUM(costo_pagado), 0
  FROM v_leche_jornada WHERE litros_aprobados = 0
  GROUP BY 1
  UNION ALL
  SELECT date_trunc('month', fecha::timestamp)::date, 0, 0, 0, 0, SUM(monto)
  FROM gasto_operativo
  GROUP BY 1
) x
GROUP BY mes;

-- Parche 001: una recolección ya liquidada no se puede anular ni cambiar en lo que afecta al pago.
-- Para corregirla hay que sacarla primero de su liquidación (posible solo mientras esa liquidación
-- siga pendiente) y luego anularla o corregirla.
CREATE FUNCTION fn_proteger_recoleccion_liquidada() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM liquidacion_detalle d WHERE d.recoleccion_id = OLD.id)
     AND (NEW.anulada_en       IS DISTINCT FROM OLD.anulada_en
          OR NEW.litros        <> OLD.litros
          OR NEW.productor_id  <> OLD.productor_id
          OR NEW.estado_calidad <> OLD.estado_calidad
          OR NEW.registrada_en <> OLD.registrada_en) THEN
    RAISE EXCEPTION 'La recolección % ya fue liquidada: no se puede anular ni modificar; quítela primero de su liquidación pendiente', OLD.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_recoleccion_proteger_liquidada BEFORE UPDATE ON recoleccion
  FOR EACH ROW EXECUTE FUNCTION fn_proteger_recoleccion_liquidada();

-- ---------------------------------------------------------------------
-- Índices de apoyo (claves foráneas que se consultan o se unen con frecuencia)
-- ---------------------------------------------------------------------
CREATE INDEX ix_recoleccion_ruta        ON recoleccion (ruta_id);
CREATE INDEX ix_recoleccion_calidad_por ON recoleccion (calidad_por, calidad_en);
CREATE INDEX ix_lote_receta             ON lote_produccion (receta_id);
CREATE INDEX ix_receta_insumo_insumo    ON receta_insumo (insumo_id);
CREATE INDEX ix_venta_cliente           ON venta (cliente_id);
CREATE INDEX ix_gasto_categoria         ON gasto_operativo (categoria_id);
CREATE INDEX ix_gasto_acopiador         ON gasto_operativo (acopiador_id);

-- ---------------------------------------------------------------------
-- Auditoría: quién cambió qué y cuándo (precios, sanciones, pagos, calidad, anulaciones...)
-- ---------------------------------------------------------------------
CREATE TABLE auditoria (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fecha      timestamptz NOT NULL DEFAULT now(),
  usuario_id bigint,                    -- viene de SET LOCAL app.usuario_id; NULL = proceso interno
  tabla      text        NOT NULL,
  registro   text,
  accion     text        NOT NULL,
  antes      jsonb,
  despues    jsonb
);
CREATE INDEX ix_auditoria_tabla ON auditoria (tabla, fecha DESC);

CREATE FUNCTION fn_auditar() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_row  jsonb;
  v_user bigint;
BEGIN
  v_user := NULLIF(current_setting('app.usuario_id', true), '')::bigint;
  v_row  := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  INSERT INTO auditoria (usuario_id, tabla, registro, accion, antes, despues)
  VALUES (v_user,
          TG_TABLE_NAME,
          COALESCE(v_row ->> 'id', v_row ->> 'clave'),
          TG_OP,
          CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END);
  RETURN NULL;
END $$;

CREATE TRIGGER trg_aud_precio_leche   AFTER INSERT OR UPDATE OR DELETE ON precio_leche          FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_aud_configuracion  AFTER INSERT OR UPDATE OR DELETE ON configuracion         FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_aud_sancion        AFTER INSERT OR UPDATE OR DELETE ON sancion_productor     FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_aud_alerta         AFTER UPDATE OR DELETE            ON alerta_recoleccion   FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_aud_liquidacion    AFTER INSERT OR UPDATE OR DELETE ON liquidacion_productor FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_aud_pago_acopiador AFTER INSERT OR UPDATE OR DELETE ON pago_acopiador        FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_aud_gasto          AFTER INSERT OR UPDATE OR DELETE ON gasto_operativo       FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_aud_receta         AFTER INSERT OR UPDATE OR DELETE ON receta                FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_aud_productor      AFTER INSERT OR UPDATE OR DELETE ON productor             FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_aud_ruta_acopiador AFTER INSERT OR UPDATE OR DELETE ON ruta_acopiador        FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_aud_lote           AFTER INSERT OR UPDATE OR DELETE ON lote_produccion       FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_aud_lote_leche     AFTER INSERT OR UPDATE OR DELETE ON lote_leche            FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_aud_merma_leche    AFTER INSERT OR UPDATE OR DELETE ON merma_leche           FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_aud_baja           AFTER INSERT OR UPDATE OR DELETE ON baja_producto         FOR EACH ROW EXECUTE FUNCTION fn_auditar();
CREATE TRIGGER trg_aud_venta          AFTER INSERT OR UPDATE OR DELETE ON venta                 FOR EACH ROW EXECUTE FUNCTION fn_auditar();
-- Recolecciones: solo cambios y borrados (los inserts son el flujo normal y muy frecuentes)
CREATE TRIGGER trg_aud_recoleccion    AFTER UPDATE OR DELETE ON recoleccion                     FOR EACH ROW EXECUTE FUNCTION fn_auditar();

-- ---------------------------------------------------------------------
-- Datos iniciales: las 4 recetas (completar rendimiento, insumos y vida útil con el cliente)
-- Quesos: precio y rendimiento por UNIDAD. Yogurt: por KILO (precio referencial, editable).
-- ---------------------------------------------------------------------
INSERT INTO receta (nombre, unidad_venta, precio_venta) VALUES
  ('Queso paria',        'unidad', 20.00),
  ('Queso pasteurizado', 'unidad', 21.00),
  ('Queso fresco',       'unidad', 23.00),
  ('Yogurt',             'kilo',    7.00);

COMMIT;
