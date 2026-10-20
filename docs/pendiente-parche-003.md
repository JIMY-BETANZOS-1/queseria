# Pendiente: parche 003 (pagos: gasto por trigger y protecciones de lo pagado)

> **Estado: PROPUESTA, sin aplicar.** Cambia `db/schema.sql`, así que necesita aprobación (ver "Regla de oro" en
> `CLAUDE.md`) y correr `db/tests/escenarios.sql` completo. Encontrado al construir Pagos (W2).

Mientras no se aplique, el backend (`backend/app/routers/pagos.py`) cubre los tres puntos. Cuando se aplique, el
backend deja de hacerlo y solo traduce los errores de la base, como en el resto del sistema.

## 1. El gasto del pago mensual del acopiador lo crea la base
**Hoy.** El comentario de `pago_acopiador` (`schema.sql:1458`) dice que al pagarse "genera su gasto_operativo
(categoría 'Sueldo acopiador')", pero no hay trigger que lo haga. El CHECK `ck_pago_acopiador_estado` exige
`gasto_id` para marcarlo pagado, así que `POST /pagos/acopiadores/{id}/pagar` crea el gasto y marca el pago en la
misma transacción. Por eso también `POST /gastos` rechaza la categoría "Sueldo acopiador": esos gastos solo los
crea el pago mensual.

**Propuesta.** Un trigger `BEFORE UPDATE OF estado` que, al pasar de `pendiente` a `pagado`, inserte el gasto y
complete `gasto_id` y `pagado_en`. Detalle comprobado en PostgreSQL 18.4: en un trigger `BEFORE` la columna
generada `total` todavía es `NULL`, así que el monto se calcula con sus partes.

```sql
CREATE FUNCTION fn_pago_acopiador_gasto() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado = 'pendiente' AND NEW.estado = 'pagado' AND NEW.gasto_id IS NULL THEN
    INSERT INTO gasto_operativo (fecha, categoria_id, descripcion, monto, acopiador_id, registrado_por)
    VALUES ((now() AT TIME ZONE 'America/Lima')::date,
            (SELECT id FROM categoria_gasto WHERE nombre = 'Sueldo acopiador'),
            'Sueldo ' || to_char(NEW.mes, 'MM/YYYY'),
            NEW.sueldo_base + NEW.comision + NEW.ajustes,          -- NEW.total aún es NULL en BEFORE
            NEW.acopiador_id,
            NULLIF(current_setting('app.usuario_id', true), '')::bigint)
    RETURNING id INTO NEW.gasto_id;
    NEW.pagado_en := COALESCE(NEW.pagado_en, now());
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_pago_acopiador_gasto BEFORE UPDATE OF estado ON pago_acopiador
  FOR EACH ROW EXECUTE FUNCTION fn_pago_acopiador_gasto();
```
- Un total de cero o negativo lo sigue rechazando el CHECK `monto > 0` de `gasto_operativo`.
- Sin `app.usuario_id` (una actualización a mano sin el `SET LOCAL` de la API), `registrado_por` queda NULL y la
  base la rechaza: es lo correcto, porque el gasto necesita autor.

## 2. Una liquidación pagada no se puede eliminar ni modificar
**Hoy (hueco de la base).** `fn_proteger_liquidacion_pagada` protege `liquidacion_detalle`, pero al borrar la
cabecera, `ON DELETE CASCADE` borra el detalle cuando la cabecera ya no se ve: el trigger no detecta que estaba
pagada y **la base deja borrar una liquidación pagada**. Lo mostró una prueba del backend en `queseria_test`.
`DELETE /liquidaciones/{id}` por eso solo borra las pendientes.

**Propuesta.** Proteger la cabecera misma:

```sql
CREATE FUNCTION fn_proteger_cabecera_liquidacion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado = 'pagado' THEN
    RAISE EXCEPTION 'La liquidación % ya está pagada y no se puede modificar ni eliminar', OLD.id;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_liq_proteger_pagada BEFORE UPDATE OR DELETE ON liquidacion_productor
  FOR EACH ROW EXECUTE FUNCTION fn_proteger_cabecera_liquidacion();
```
- Pasar de `pendiente` a `pagado` sigue permitido (`OLD.estado` es `pendiente`); `fn_validar_liquidacion` sigue
  exigiendo detalle.

## 3. Un pago de acopiador pagado no se puede modificar ni eliminar
**Hoy.** No hay trigger: `PATCH` y `DELETE /pagos/acopiadores/{id}` comprueban en el backend que esté pendiente.

**Propuesta.**

```sql
CREATE FUNCTION fn_proteger_pago_acopiador() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado = 'pagado' THEN
    RAISE EXCEPTION 'El pago % del acopiador ya está pagado y no se puede modificar ni eliminar', OLD.id;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_pago_acopiador_proteger BEFORE UPDATE OR DELETE ON pago_acopiador
  FOR EACH ROW EXECUTE FUNCTION fn_proteger_pago_acopiador();
```
- Los triggers `BEFORE` de una tabla corren en orden alfabético de nombre: `trg_pago_acopiador_gasto` antes que
  `trg_pago_acopiador_proteger`. Como este solo mira `OLD.estado`, el paso de pendiente a pagado no lo afecta.

## Pasos si se aprueba (cada uno con su propia aprobación)
1. **`db/`:** los tres cambios en `db/schema.sql` y un archivo en `db/migraciones/` para la base existente (el
   formato de `2026-10-bloque6-pin-null.sql`); escenarios nuevos en `db/tests/escenarios.sql` (pagar crea el gasto;
   no se borra ni modifica una liquidación o un pago pagados) y correrlo completo.
2. **`backend/`:** `pagar_acopiador` pasa a ser solo `UPDATE ... SET estado = 'pagado'` (devolviendo el gasto que
   creó la base); se quitan las tres guardas de `pagos.py` y su texto en el docstring; las pruebas esperan los
   mensajes de la base.
3. **Documentación:** corregir el comentario de `schema.sql:1458` (ya no sería falso) y cerrar este archivo.
