"""Precio de la leche al productor: historial (no se edita ni se borra; se agrega una fila con su vigencia)."""
from datetime import date, datetime
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from .. import db
from ..deps import Usuario, solo_admin
from ..esquemas import Entrada

router = APIRouter(prefix="/precios-leche", tags=["precio de la leche"])


class PrecioNuevo(Entrada):
    tipo: Literal["normal", "sancion"]
    precio_litro: float
    vigente_desde: date


class Precio(BaseModel):
    id: int
    tipo: Literal["normal", "sancion"]
    precio_litro: float
    vigente_desde: date
    creado_por: int | None
    creado_por_nombre: str | None
    creado_en: datetime


SELECT_PRECIO = """
    SELECT p.*, u.nombre_completo AS creado_por_nombre
      FROM precio_leche p LEFT JOIN usuario u ON u.id = p.creado_por
"""


@router.get("", response_model=list[Precio])
def historial(usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        return db.todos(conn, SELECT_PRECIO + " ORDER BY p.vigente_desde DESC, p.tipo")


@router.post("", response_model=Precio, status_code=201)
def crear(datos: PrecioNuevo, usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        fila = db.uno(conn, """
            INSERT INTO precio_leche (tipo, precio_litro, vigente_desde, creado_por)
            VALUES (%s, %s, %s, %s) RETURNING id
        """, (datos.tipo, datos.precio_litro, datos.vigente_desde, usuario.id))
        return db.uno(conn, SELECT_PRECIO + " WHERE p.id = %s", (fila["id"],))
