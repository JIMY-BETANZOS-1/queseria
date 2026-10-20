"""Gastos operativos (los que no son de un lote): listar y registrar. No se editan ni se eliminan desde la API.

Los de la categoría "Sueldo acopiador" solo los crea el pago mensual del acopiador (routers/pagos.py), en la
misma transacción que lo marca pagado: registrarlos a mano los contaría dos veces en el flujo y en el resultado.
"""
from datetime import date

import psycopg
from fastapi import APIRouter, Depends

from .. import db
from ..deps import Usuario, solo_admin
from ..errores import CHECKS, conflicto, validacion
from ..esquemas.gastos import CategoriaGasto, Gasto, GastoNuevo
from .rutas import HOY_LIMA

router = APIRouter(tags=["gastos"])

CATEGORIA_DEL_PAGO_MENSUAL = "Sueldo acopiador"
MAX_DIAS = 400

SELECT_GASTO = """
    SELECT g.id, g.fecha, g.categoria_id, c.nombre AS categoria, g.descripcion, g.monto,
           g.acopiador_id, ua.nombre_completo AS acopiador, g.registrado_por, ur.nombre_completo AS registrado_por_nombre,
           g.creado_en, EXISTS (SELECT 1 FROM pago_acopiador pa WHERE pa.gasto_id = g.id) AS del_pago_mensual
      FROM gasto_operativo g
      JOIN categoria_gasto c ON c.id = g.categoria_id
      JOIN usuario ur        ON ur.id = g.registrado_por
      LEFT JOIN usuario ua   ON ua.id = g.acopiador_id
"""


@router.get("/categorias-gasto", response_model=list[CategoriaGasto])
def categorias(usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        return db.todos(conn, "SELECT id, nombre, nombre <> %s AS manual FROM categoria_gasto ORDER BY nombre",
                        (CATEGORIA_DEL_PAGO_MENSUAL,))


@router.get("/gastos", response_model=list[Gasto])
def listar(desde: date, hasta: date, usuario: Usuario = Depends(solo_admin)):
    """Los del rango, del más reciente al más antiguo (también los creados por el pago mensual)."""
    if hasta < desde:
        raise validacion("La fecha final no puede ser anterior a la inicial")
    if (hasta - desde).days >= MAX_DIAS:
        raise validacion(f"Pida como máximo {MAX_DIAS} días")
    with db.transaccion(usuario.id) as conn:
        return db.todos(conn, SELECT_GASTO + " WHERE g.fecha BETWEEN %s AND %s ORDER BY g.fecha DESC, g.id DESC",
                        (desde, hasta))


@router.post("/gastos", response_model=Gasto, status_code=201)
def registrar(datos: GastoNuevo, usuario: Usuario = Depends(solo_admin)):
    """Monto cero o negativo: lo rechaza la base (CHECK monto > 0) y se responde 409, como en Pagos.
    Categoría o acopiador inexistentes: los rechaza la base (claves foráneas)."""
    with db.transaccion(usuario.id) as conn:
        categoria = db.uno(conn, "SELECT nombre FROM categoria_gasto WHERE id = %s", (datos.categoria_id,))
        if categoria is not None and categoria["nombre"] == CATEGORIA_DEL_PAGO_MENSUAL:
            raise conflicto(f"Los gastos de «{CATEGORIA_DEL_PAGO_MENSUAL}» solo los crea el pago mensual del acopiador "
                            "(Pagos a acopiadores): así no se cuentan dos veces")
        try:
            with conn.transaction():
                fila = db.uno(conn, f"""
                    INSERT INTO gasto_operativo (fecha, categoria_id, descripcion, monto, acopiador_id, registrado_por)
                    VALUES (COALESCE(%(fecha)s, {HOY_LIMA}), %(categoria)s, %(descripcion)s, %(monto)s, %(acopiador)s,
                            %(usuario)s)
                    RETURNING id
                """, {"fecha": datos.fecha, "categoria": datos.categoria_id, "descripcion": datos.descripcion,
                      "monto": datos.monto, "acopiador": datos.acopiador_id, "usuario": usuario.id})
        except psycopg.errors.CheckViolation as e:
            if e.diag.constraint_name == "gasto_operativo_monto_check":
                raise conflicto(CHECKS["gasto_operativo_monto_check"]) from e
            raise
        return db.uno(conn, SELECT_GASTO + " WHERE g.id = %s", (fila["id"],))
