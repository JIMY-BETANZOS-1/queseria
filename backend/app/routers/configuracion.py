"""Parámetros de negocio (tabla configuracion). Solo se editan claves existentes."""
import re

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from .. import db
from ..deps import Usuario, solo_admin
from ..errores import no_encontrado, validacion
from ..esquemas import Entrada

router = APIRouter(prefix="/configuracion", tags=["configuración"])


class Parametro(BaseModel):
    clave: str
    valor: str
    descripcion: str | None


class NuevoValor(Entrada):
    valor: str = Field(min_length=1)


# Formato que debe conservar el valor (se deduce del valor actual). Los triggers convierten con
# valor::int / valor::numeric, así que un valor con otro formato rompería el registro de recolecciones.
FORMATOS = [
    ("entero", re.compile(r"^-?\d+$")),
    ("número", re.compile(r"^-?\d+(\.\d+)?$")),
    ("true o false", re.compile(r"^(true|false)$")),
    ("color #RRGGBB", re.compile(r"^#[0-9A-Fa-f]{6}$")),
]


def _formato(valor: str) -> tuple[str, re.Pattern] | None:
    return next(((n, p) for n, p in FORMATOS if p.match(valor)), None)


@router.get("", response_model=list[Parametro])
def listar(usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        return db.todos(conn, "SELECT clave, valor, descripcion FROM configuracion ORDER BY clave")


@router.put("/{clave}", response_model=Parametro)
def editar(clave: str, datos: NuevoValor, usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        actual = db.uno(conn, "SELECT valor FROM configuracion WHERE clave = %s FOR UPDATE", (clave,))
        if actual is None:
            raise no_encontrado("El parámetro no existe")
        formato = _formato(actual["valor"])
        if formato is not None and not formato[1].match(datos.valor):
            raise validacion(f"El valor de '{clave}' debe ser {formato[0]}")
        return db.uno(conn, "UPDATE configuracion SET valor = %s WHERE clave = %s RETURNING clave, valor, descripcion",
                      (datos.valor, clave))
