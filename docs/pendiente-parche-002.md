# Pendiente: parche 002 (quién anuló una recolección y por qué)

> **Estado: PROPUESTA, sin aplicar.** Cambia una vista de `db/schema.sql`, así que necesita aprobación
> (ver "Regla de oro" en `CLAUDE.md`). Encontrado en el Bloque W1, paso 9.

## Problema
`POST /recolecciones/{id}/anular` guarda en `recoleccion` los tres datos de la anulación (`anulada_en`,
`anulada_por`, `motivo_anulacion`; el CHECK de `schema.sql:326-328` exige los tres juntos). Pero
`v_recoleccion_detalle` (`schema.sql:973`) solo expone `anulada_en`, y de esa vista leen `GET /recolecciones`,
`GET /productores/{id}/recolecciones`, la respuesta de anular y las alertas. Por eso el panel web muestra que una
recolección está anulada y cuándo, pero no quién la anuló ni por qué.

## Cambio propuesto
`CREATE OR REPLACE VIEW` permite agregar columnas solo **al final** y sin cambiar las existentes: las 28
columnas actuales quedan idénticas y en el mismo orden, y se suman 3. Ninguna vista de la base depende de
`v_recoleccion_detalle`. El backend la lee con columnas explícitas (`routers/acopiador.py`) o con `SELECT *`
filtrado por su modelo pydantic (`RecoleccionDetalle`, `Alerta`), así que nada se rompe antes de tocar el backend.

```sql
-- =====================================================================
-- Parche 002: quién anuló una recolección y por qué, en v_recoleccion_detalle.
-- Para una base que ya existe (db/schema.sql se actualiza con el mismo cambio):
--   psql -X -v ON_ERROR_STOP=1 -d queseria -f db/migraciones/<fecha>-parche-002-anulacion.sql
-- No modifica datos.
-- =====================================================================
BEGIN;

CREATE OR REPLACE VIEW v_recoleccion_detalle AS
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
       r.anulada_en,
       -- Parche 002: nuevas, al final
       r.anulada_por,
       ua.nombre_completo        AS anulada_por_nombre,
       r.motivo_anulacion
FROM recoleccion r
JOIN productor p        ON p.id = r.productor_id
JOIN usuario u          ON u.id = r.registrado_por
LEFT JOIN acopiador a   ON a.usuario_id = r.registrado_por
LEFT JOIN ruta rt       ON rt.id = r.ruta_id
LEFT JOIN v_recoleccion_pago pg ON pg.recoleccion_id = r.id
LEFT JOIN usuario ua    ON ua.id = r.anulada_por;

COMMIT;
```

## Pasos si se aprueba (cada uno con su propia aprobación)
1. **`db/`:** el mismo cambio en `db/schema.sql` y el archivo de migración en `db/migraciones/`; correr
   `db/tests/escenarios.sql` completo.
2. **`backend/`:** agregar `anulada_por`, `anulada_por_nombre` y `motivo_anulacion` a `RecoleccionDetalle`
   (`app/esquemas/recolecciones.py`), con pruebas.
3. **`backend/`, aparte y sin tocar `db/`:** sumar `revisada_por_nombre` a `SELECT_ALERTA`
   (`app/routers/alertas.py`) con `LEFT JOIN usuario`, para mostrar quién revisó una alerta aunque no sea el admin
   de la sesión.
4. **`web/`:** regenerar `src/api/esquema.d.ts` con `.\web\scripts\tipos.ps1` y mostrar "Anulada por X el
   dd/mm hh:mm" con el motivo, y "Revisada por X" con el nombre real.
