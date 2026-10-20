"""Merma de leche (A8b): listar y registrar. No se edita ni se elimina desde la API.

Las reglas son de la base (merma_leche, fn_merma_leche): solo se merma leche aprobada de la jornada que aún no
está en un lote ni en otra merma. Lo que rechaza vuelve como 409 con su mensaje.
"""
from datetime import date

import psycopg
from fastapi import APIRouter, Depends

from .. import db
from ..deps import Usuario, solo_admin
from ..errores import CHECKS, conflicto, validacion
from ..esquemas.mermas import Merma, MermaNueva

router = APIRouter(tags=["mermas"])

MAX_DIAS = 400

SELECT_MERMA = """
    SELECT m.id, m.fecha, m.litros, m.motivo, m.registrado_por, u.nombre_completo AS registrado_por_nombre,
           m.creado_en, round(m.litros * j.costo_litro_util, 2) AS valor_perdida
      FROM merma_leche m
      JOIN usuario u              ON u.id = m.registrado_por
      LEFT JOIN v_leche_jornada j ON j.fecha = m.fecha
"""


@router.get("/mermas", response_model=list[Merma])
def listar(desde: date, hasta: date, usuario: Usuario = Depends(solo_admin)):
    """Las mermas de las jornadas del rango, de la más reciente a la más antigua."""
    if hasta < desde:
        raise validacion("La fecha final no puede ser anterior a la inicial")
    if (hasta - desde).days >= MAX_DIAS:
        raise validacion(f"Pida como máximo {MAX_DIAS} días")
    with db.transaccion(usuario.id) as conn:
        return db.todos(conn, SELECT_MERMA + " WHERE m.fecha BETWEEN %s AND %s ORDER BY m.fecha DESC, m.id DESC",
                        (desde, hasta))


@router.post("/mermas", response_model=Merma, status_code=201)
def registrar(datos: MermaNueva, usuario: Usuario = Depends(solo_admin)):
    """Litros de más (o una jornada sin leche aprobada): lo rechaza fn_merma_leche (P0001 → 409).
    Litros cero o negativos: CHECK litros > 0, también como 409."""
    with db.transaccion(usuario.id) as conn:
        try:
            with conn.transaction():
                fila = db.uno(conn, """
                    INSERT INTO merma_leche (fecha, litros, motivo, registrado_por)
                    VALUES (%s, %s, %s, %s) RETURNING id
                """, (datos.fecha, datos.litros, datos.motivo, usuario.id))
        except psycopg.errors.CheckViolation as e:
            if e.diag.constraint_name in CHECKS:
                raise conflicto(CHECKS[e.diag.constraint_name]) from e
            raise
        return db.uno(conn, SELECT_MERMA + " WHERE m.id = %s", (fila["id"],))
