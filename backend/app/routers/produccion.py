"""Producción y venta rápidas (W2, opción B): un lote en un paso y una venta al contado de una línea.

Las reglas son de la base y aquí solo se insertan filas en orden: lote_leche exige leche aprobada disponible de la
jornada y congela su costo (fn_lote_leche); el consumo descuenta stock y falla si no alcanza (fn_movimiento_insumo);
no se cierra sin leche (fn_validar_lote); la venta exige lote cerrado, con saldo, sin vencer y no anterior a la
producción (fn_validar_saldo_lote). Sus errores (P0001) vuelven como 409 con el mensaje de la base.

Conveniencias del backend (no reglas): el consumo sugerido de insumos (cantidad de la receta × litros ÷ litros_base)
y el código del lote L-AAAA-NNNN. Pendiente: la base no tiene secuencia para lote_produccion.codigo (docs).
"""
from datetime import date

import psycopg
from fastapi import APIRouter, Depends, Query

from .. import db
from ..deps import Usuario, solo_admin
from ..errores import CHECKS, conflicto, no_encontrado
from ..esquemas.produccion import (Cliente, ClienteNuevo, IngresoInsumo, IngresoRegistrado, InsumoNuevo, InsumoStock,
                                   Lote, LoteDisponible, PreviaProduccion, ProduccionRapida, Receta, Venta, VentaRapida)
from .rutas import HOY_LIMA

router = APIRouter(tags=["producción y ventas"])

# Consumo sugerido de cada insumo de la receta para los litros pedidos, con el stock de hoy
SQL_INSUMOS = """
    SELECT ri.insumo_id, i.nombre, i.unidad::text AS unidad,
           round(ri.cantidad * %(litros)s::numeric / r.litros_base, 3) AS necesita,
           COALESCE(s.stock, 0) AS hay
      FROM receta r
      JOIN receta_insumo ri ON ri.receta_id = r.id
      JOIN insumo i ON i.id = ri.insumo_id
      LEFT JOIN v_insumo_stock s ON s.insumo_id = ri.insumo_id
     WHERE r.id = %(receta)s
     ORDER BY i.nombre
"""

SELECT_VENTA = """
    SELECT v.id AS venta_id, v.fecha, v.cliente_id, c.nombre AS cliente, d.lote_id, l.codigo AS codigo_lote,
           r.nombre AS receta, d.cantidad, d.precio_unitario, d.subtotal
      FROM venta v
      JOIN cliente c ON c.id = v.cliente_id
      JOIN venta_detalle d ON d.venta_id = v.id
      JOIN lote_produccion l ON l.id = d.lote_id
      JOIN receta r ON r.id = l.receta_id
"""


# Receta con sus insumos (también la usa el editor, routers/recetas.py)
SELECT_RECETA = """
    SELECT r.*, COALESCE((
             SELECT json_agg(json_build_object('insumo_id', i.id, 'nombre', i.nombre, 'unidad', i.unidad,
                                               'cantidad', ri.cantidad) ORDER BY i.nombre)
               FROM receta_insumo ri JOIN insumo i ON i.id = ri.insumo_id
              WHERE ri.receta_id = r.id), '[]'::json) AS insumos,
           (SELECT COUNT(*) FROM lote_produccion l WHERE l.receta_id = r.id) AS n_lotes
      FROM receta r
"""


def _receta(conn, receta_id: int) -> dict:
    fila = db.uno(conn, "SELECT * FROM receta WHERE id = %s", (receta_id,))
    if fila is None:
        raise no_encontrado("La receta no existe")
    return fila


@router.get("/recetas", response_model=list[Receta])
def recetas(usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        return db.todos(conn, SELECT_RECETA + " ORDER BY r.nombre")


SELECT_STOCK = ("SELECT insumo_id, nombre, unidad::text AS unidad, stock, estado, costo_unitario, ultima_actualizacion "
                "FROM v_insumo_stock")


@router.get("/insumos", response_model=list[InsumoStock])
def insumos(usuario: Usuario = Depends(solo_admin)):
    """Almacén: v_insumo_stock, solo insumos activos. La base no tiene stock mínimo por insumo."""
    with db.transaccion(usuario.id) as conn:
        return db.todos(conn, SELECT_STOCK + " ORDER BY nombre")


@router.post("/insumos", response_model=InsumoStock, status_code=201)
def crear_insumo(datos: InsumoNuevo, usuario: Usuario = Depends(solo_admin)):
    """Nace sin stock: su costo promedio lo fija el primer ingreso. Nombre repetido: 409 (UNIQUE de la base)."""
    with db.transaccion(usuario.id) as conn:
        nuevo = db.uno(conn, "INSERT INTO insumo (nombre, unidad) VALUES (%s, %s) RETURNING id", (datos.nombre, datos.unidad))
        return db.uno(conn, SELECT_STOCK + " WHERE insumo_id = %s", (nuevo["id"],))


@router.post("/insumos/{insumo_id}/ingresos", response_model=IngresoRegistrado, status_code=201)
def registrar_ingreso(insumo_id: int, datos: IngresoInsumo, usuario: Usuario = Depends(solo_admin)):
    """Compra de insumo: un movimiento 'ingreso'. fn_movimiento_insumo recalcula el costo promedio ponderado; los CHECK
    de la base (cantidad y costo mayores que cero) vuelven como 409 con su mensaje, como en Pagos. No se borra."""
    with db.transaccion(usuario.id) as conn:
        if db.uno(conn, "SELECT 1 FROM insumo WHERE id = %s AND activo", (insumo_id,)) is None:
            raise no_encontrado("El insumo no existe")
        try:
            with conn.transaction():
                mov = db.uno(conn, """
                    INSERT INTO movimiento_insumo (insumo_id, tipo, cantidad, costo_unitario, usuario_id, fecha, nota)
                    VALUES (%(insumo)s, 'ingreso', %(cantidad)s, %(costo)s, %(usuario)s,
                            CASE WHEN %(fecha)s::date IS NULL THEN now()
                                 ELSE (%(fecha)s::date + time '12:00') AT TIME ZONE 'America/Lima' END,
                            %(nota)s)
                    RETURNING id
                """, {"insumo": insumo_id, "cantidad": datos.cantidad, "costo": datos.costo_unitario, "usuario": usuario.id,
                      "fecha": datos.fecha, "nota": datos.nota})
        except psycopg.errors.CheckViolation as e:
            nombre = e.diag.constraint_name or ""
            if nombre in CHECKS:
                raise conflicto(CHECKS[nombre]) from e
            raise
        except psycopg.errors.DivisionByZero as e:
            # Con cantidad 0 y stock 0, fn_movimiento_insumo (BEFORE INSERT) divide por stock + cantidad antes de que
            # la base evalúe ck_mov_signo: el error real es el de ese CHECK (pendiente en la base, docs/pantallas.md)
            raise conflicto(CHECKS["ck_mov_signo"]) from e
        return {"movimiento_id": mov["id"], "insumo": db.uno(conn, SELECT_STOCK + " WHERE insumo_id = %s", (insumo_id,))}


@router.get("/produccion/previa", response_model=PreviaProduccion)
def previa(receta_id: int, fecha_leche: date, litros: float = Query(gt=0), usuario: Usuario = Depends(solo_admin)):
    """Lo que se necesita y lo que hay, antes de confirmar. No escribe nada."""
    with db.transaccion(usuario.id) as conn:
        r = _receta(conn, receta_id)
        jornada = db.uno(conn, """
            SELECT fn_leche_disponible(%(f)s) AS disponible,
                   (SELECT costo_litro_util FROM v_leche_jornada WHERE fecha = %(f)s) AS costo
        """, {"f": fecha_leche})
        insumos = db.todos(conn, SQL_INSUMOS, {"litros": litros, "receta": receta_id})
    estimado = None if r["rendimiento_base"] is None else round(float(r["rendimiento_base"]) * litros / float(r["litros_base"]), 2)
    return {"leche_disponible": jornada["disponible"], "costo_litro": jornada["costo"], "rendimiento_estimado": estimado,
            "insumos": [{**i, "falta": max(0.0, float(i["necesita"]) - float(i["hay"]))} for i in insumos]}


@router.post("/produccion", response_model=Lote, status_code=201)
def producir(datos: ProduccionRapida, usuario: Usuario = Depends(solo_admin)):
    """Crea el lote, le asigna la leche, consume los insumos sugeridos y lo cierra, todo en una transacción."""
    p = {**datos.model_dump(), "usuario": usuario.id}
    with db.transaccion(usuario.id) as conn:
        _receta(conn, datos.receta_id)
        fecha_prod = db.uno(conn, f"SELECT COALESCE(%(fecha_produccion)s::date, {HOY_LIMA}) AS f", p)["f"]
        # Código L-AAAA-NNNN: un candado por año evita que dos lotes simultáneos tomen el mismo número
        conn.execute("SELECT pg_advisory_xact_lock(hashtext('lote_codigo'), %s)", (fecha_prod.year,))
        prefijo = f"L-{fecha_prod.year}-"
        ultimo = db.uno(conn, """
            SELECT COALESCE(MAX(substring(codigo FROM %s)::int), 0) AS n
              FROM lote_produccion WHERE codigo ~ %s
        """, (f"^{prefijo}(\\d+)$", f"^{prefijo}\\d+$"))["n"]
        lote = db.uno(conn, """
            INSERT INTO lote_produccion (codigo, receta_id, fecha_produccion, creado_por)
            VALUES (%s, %s, %s, %s) RETURNING id
        """, (f"{prefijo}{ultimo + 1:04d}", datos.receta_id, fecha_prod, usuario.id))["id"]
        conn.execute("""
            INSERT INTO lote_leche (lote_id, fecha, litros, costo_litro) VALUES (%s, %s, %s, 0)
        """, (lote, datos.fecha_leche, datos.litros))   # costo_litro lo fija fn_lote_leche
        for insumo in db.todos(conn, SQL_INSUMOS, {"litros": datos.litros, "receta": datos.receta_id}):
            if float(insumo["necesita"]) > 0:
                conn.execute("""
                    INSERT INTO movimiento_insumo (insumo_id, tipo, cantidad, lote_id, usuario_id, nota)
                    VALUES (%s, 'consumo_lote', %s, %s, %s, 'Consumo sugerido por la receta')
                """, (insumo["insumo_id"], -insumo["necesita"], lote, usuario.id))
        conn.execute("""
            UPDATE lote_produccion SET estado = 'cerrado', cantidad_producida = %s, cerrado_en = now() WHERE id = %s
        """, (datos.cantidad_producida, lote))
        return db.uno(conn, "SELECT * FROM v_lote_resumen WHERE lote_id = %s", (lote,))


@router.get("/lotes", response_model=list[Lote])
def lotes(usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        return db.todos(conn, "SELECT * FROM v_lote_resumen ORDER BY fecha_produccion DESC, codigo DESC LIMIT 500")


@router.get("/lotes/disponibles", response_model=list[LoteDisponible])
def lotes_disponibles(usuario: Usuario = Depends(solo_admin)):
    """Cerrados y con saldo, el que vence primero arriba (orden de v_lote_disponible)."""
    with db.transaccion(usuario.id) as conn:
        return db.todos(conn, """
            SELECT d.*, r.unidad_venta::text AS unidad_venta, r.precio_venta
              FROM v_lote_disponible d
              JOIN lote_produccion l ON l.id = d.lote_id
              JOIN receta r ON r.id = l.receta_id
        """)


@router.get("/clientes", response_model=list[Cliente])
def clientes(usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        return db.todos(conn, "SELECT id, nombre, tipo::text AS tipo, documento, celular FROM cliente ORDER BY nombre")


@router.post("/clientes", response_model=Cliente, status_code=201)
def crear_cliente(datos: ClienteNuevo, usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        return db.uno(conn, """
            INSERT INTO cliente (nombre, tipo, documento, celular) VALUES (%(nombre)s, %(tipo)s, %(documento)s, %(celular)s)
            RETURNING id, nombre, tipo::text AS tipo, documento, celular
        """, datos.model_dump())


@router.post("/ventas", response_model=Venta, status_code=201)
def vender(datos: VentaRapida, usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        venta = db.uno(conn, f"""
            INSERT INTO venta (cliente_id, fecha, registrada_por, observacion)
            VALUES (%(cliente)s, COALESCE(%(fecha)s, {HOY_LIMA}), %(usuario)s, %(obs)s) RETURNING id
        """, {"cliente": datos.cliente_id, "fecha": datos.fecha, "usuario": usuario.id, "obs": datos.observacion})["id"]
        conn.execute("""
            INSERT INTO venta_detalle (venta_id, lote_id, cantidad, precio_unitario) VALUES (%s, %s, %s, %s)
        """, (venta, datos.lote_id, datos.cantidad, datos.precio_unitario))
        return db.uno(conn, SELECT_VENTA + " WHERE v.id = %s", (venta,))


@router.get("/ventas", response_model=list[Venta])
def ventas(desde: date, hasta: date, usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        return db.todos(conn, SELECT_VENTA + " WHERE v.fecha BETWEEN %s AND %s ORDER BY v.fecha DESC, v.id DESC",
                        (desde, hasta))
