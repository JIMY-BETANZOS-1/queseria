-- =====================================================================
-- Migración Bloque 6: PIN propio de 4 dígitos al activar el celular.
--
-- El admin ya no define el PIN inicial: el usuario móvil nace con pin_hash NULL ("pendiente de
-- activar") y lo crea al activar su celular con el código del admin. db/schema.sql ya trae este
-- cambio; este archivo es para una base que ya existe:
--   psql -X -v ON_ERROR_STOP=1 -d queseria -f db/migraciones/2026-10-bloque6-pin-null.sql
-- Los usuarios existentes cumplen las dos restricciones (todos tienen pin_hash), así que no se
-- modifican datos.
-- =====================================================================
BEGIN;

ALTER TABLE usuario DROP CONSTRAINT ck_usuario_credenciales;
ALTER TABLE usuario ADD CONSTRAINT ck_usuario_credenciales CHECK (
  (rol = 'admin'
     AND email IS NOT NULL AND password_hash IS NOT NULL)
  OR
  (rol IN ('acopiador', 'analista')
     AND dni IS NOT NULL AND celular IS NOT NULL)
);

-- No hay fecha de PIN sin PIN
ALTER TABLE usuario ADD CONSTRAINT ck_usuario_pin_fecha
  CHECK (pin_actualizado_en IS NULL OR pin_hash IS NOT NULL);

COMMIT;
