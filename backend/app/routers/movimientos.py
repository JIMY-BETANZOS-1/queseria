"""Movimientos del mes (libro de solo lectura): ventas, pagos a productores, compras de insumos, gastos, costos de
lote, mermas de leche y bajas de producto, en orden cronológico.

Cada tipo se ubica en el mes con la misma fecha que usan v_flujo_mensual y v_resultado_mensual, salvo los pagos a
productores: aquí van en la fecha en que se pagó la liquidación (pago real); el flujo cuenta la leche en la fecha de
entrega. Los sueldos de acopiadores salen una vez, como su gasto "Sueldo acopiador" (pago_acopiador no se lista).
"""
from datetime import date

from fastapi import APIRouter, Depends

from .. import db
from ..deps import Usuario, solo_admin
from ..esquemas.movimientos import Movimiento, TipoMovimiento

router = APIRouter(tags=["movimientos"])

SQL_MOVIMIENTOS = """
    SELECT * FROM (
      SELECT 'venta' AS tipo, v.fecha, v.creado_en AS registrado_en,
             'Venta a ' || c.nombre || ': ' || trim_scale(d.cantidad) || ' de ' || r.nombre
               || ' × S/ ' || to_char(d.precio_unitario, 'FM999999990.00') AS descripcion,
             l.codigo AS referencia, NULL::bigint AS liquidacion_id,
             d.subtotal AS ingreso, NULL::numeric AS egreso, NULL::numeric AS perdida
        FROM venta v
        JOIN venta_detalle d   ON d.venta_id = v.id
        JOIN cliente c         ON c.id = v.cliente_id
        JOIN lote_produccion l ON l.id = d.lote_id
        JOIN receta r          ON r.id = l.receta_id
      UNION ALL
      SELECT 'pago_productor', (q.pagada_en AT TIME ZONE 'America/Lima')::date, q.pagada_en,
             'Liquidación n.º ' || q.liquidacion_id || ': ' || q.productor || ' (del ' || to_char(q.desde, 'DD/MM/YYYY')
               || ' al ' || to_char(q.hasta, 'DD/MM/YYYY') || ')',
             q.productor_codigo, q.liquidacion_id, NULL, q.monto, NULL
        FROM v_liquidacion_productor q
       WHERE q.estado = 'pagado'
      UNION ALL
      SELECT 'compra_insumo', (m.fecha AT TIME ZONE 'America/Lima')::date, m.fecha,
             CASE m.tipo WHEN 'stock_inicial' THEN 'Stock inicial: ' ELSE 'Compra: ' END || i.nombre || ' '
               || trim_scale(m.cantidad) || ' ' || i.unidad || ' × S/ ' || to_char(m.costo_unitario, 'FM999999990.0000')
               || COALESCE(' · ' || m.nota, ''),
             NULL, NULL, NULL, round(m.cantidad * m.costo_unitario, 2), NULL
        FROM movimiento_insumo m
        JOIN insumo i ON i.id = m.insumo_id
       WHERE m.tipo IN ('stock_inicial', 'ingreso')
      UNION ALL
      SELECT 'gasto', g.fecha, g.creado_en,
             cg.nombre || COALESCE(': ' || g.descripcion, '') || COALESCE(' · ' || ua.nombre_completo, ''),
             NULL, NULL, NULL, g.monto, NULL
        FROM gasto_operativo g
        JOIN categoria_gasto cg ON cg.id = g.categoria_id
        LEFT JOIN usuario ua    ON ua.id = g.acopiador_id
      UNION ALL
      SELECT 'costo_lote', l.fecha_produccion, l.creado_en,
             'Costo del lote (' || replace(lc.concepto::text, '_', ' ') || ')' || COALESCE(': ' || lc.descripcion, ''),
             l.codigo, NULL, NULL, lc.monto, NULL
        FROM lote_costo lc
        JOIN lote_produccion l ON l.id = lc.lote_id
      UNION ALL
      SELECT 'merma', mm.fecha, mm.creado_en,
             'Merma de leche: ' || trim_scale(mm.litros) || ' L · ' || mm.motivo,
             NULL, NULL, NULL, NULL, round(mm.litros * COALESCE(j.costo_litro_util, 0), 2)
        FROM merma_leche mm
        LEFT JOIN v_leche_jornada j ON j.fecha = mm.fecha
      UNION ALL
      SELECT 'baja', b.fecha, b.creado_en,
             'Baja (' || b.motivo || '): ' || trim_scale(b.cantidad) || ' de ' || rb.nombre || COALESCE(' · ' || b.nota, ''),
             lb.codigo, NULL, NULL, NULL,
             round(COALESCE(b.cantidad * vr.costo_total / NULLIF(vr.cantidad_producida, 0), 0), 2)
        FROM baja_producto b
        JOIN lote_produccion lb ON lb.id = b.lote_id
        JOIN receta rb          ON rb.id = lb.receta_id
        JOIN v_lote_resumen vr  ON vr.lote_id = b.lote_id
    ) x
    WHERE x.fecha >= %(inicio)s AND x.fecha < (%(inicio)s + interval '1 month')::date
      AND (%(tipo)s::text IS NULL OR x.tipo = %(tipo)s::text)
    ORDER BY x.fecha, x.registrado_en, x.tipo
"""


@router.get("/movimientos", response_model=list[Movimiento])
def movimientos(mes: date, tipo: TipoMovimiento | None = None, usuario: Usuario = Depends(solo_admin)):
    """Los movimientos del mes de `mes` (cualquier día del mes), opcionalmente de un solo tipo."""
    with db.transaccion(usuario.id) as conn:
        return db.todos(conn, SQL_MOVIMIENTOS, {"inicio": mes.replace(day=1), "tipo": tipo})
