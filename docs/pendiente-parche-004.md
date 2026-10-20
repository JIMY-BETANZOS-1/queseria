# Pendiente: parche 004 (recetas: no cambiar lo que altera lotes ya hechos)

> **Estado: PROPUESTA, sin aplicar.** Cambia `db/schema.sql`, así que necesita aprobación (ver "Regla de oro" en
> `CLAUDE.md`) y correr `db/tests/escenarios.sql` completo. Encontrado al construir el editor de recetas (W2).

Mientras no se aplique, el backend (`backend/app/routers/recetas.py`) cubre la regla. Cuando se aplique, el backend
deja de hacerlo y solo traduce el error de la base, como en el resto del sistema.

## Qué pasa hoy
Los costos de un lote ya hecho están guardados en el propio lote (`lote_leche.costo_litro`, los movimientos de
consumo y `lote_costo`): cambiar la receta no los toca. Pero `v_lote_resumen` y `v_lote_disponible` calculan, con los
valores **actuales** de la receta:
- el rendimiento teórico y la desviación (`litros_base`, `rendimiento_base`);
- la fecha de vencimiento, los días para vencer, "por vencer" y "vencido" (`dias_vida_util`).

Además, `cantidad_producida` de cada lote está en la `unidad_venta` de su receta: cambiarla cambia el sentido de
lo ya producido y vendido.

## Propuesta
Un trigger `BEFORE UPDATE` en `receta` que rechace el cambio de esos cuatro campos si la receta ya tiene lotes. El
nombre, el precio de venta, `activa` y los insumos (`receta_insumo`) siguen libres: solo afectan a la producción
futura. Para cambiar uno de los cuatro, se crea una receta nueva ("Duplicar como nueva" en el panel) y se desactiva
la anterior.

```sql
CREATE FUNCTION fn_proteger_receta_con_lotes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.unidad_venta, NEW.litros_base, NEW.rendimiento_base, NEW.dias_vida_util)
       IS DISTINCT FROM (OLD.unidad_venta, OLD.litros_base, OLD.rendimiento_base, OLD.dias_vida_util)
     AND EXISTS (SELECT 1 FROM lote_produccion WHERE receta_id = OLD.id) THEN
    RAISE EXCEPTION 'La receta % ya tiene lotes: no se cambian su unidad de venta, litros base, rendimiento ni vida útil; cree una receta nueva', OLD.nombre;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_receta_proteger_lotes BEFORE UPDATE ON receta
  FOR EACH ROW EXECUTE FUNCTION fn_proteger_receta_con_lotes();
```

Escenarios a agregar en `db/tests/escenarios.sql`: con un lote, cambiar `dias_vida_util` falla y
`v_lote_resumen.fecha_vencimiento` no cambia; con un lote, cambiar el precio o los insumos funciona; sin lotes,
todo se puede cambiar.

Alternativa (más trabajo): guardar en `lote_produccion` los valores de la receta al crearlo (unidad, litros base,
rendimiento, vida útil) y que las vistas los lean de ahí. Así la receta quedaría libre de cambiarse siempre.
