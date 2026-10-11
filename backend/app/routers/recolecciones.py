"""Lectura de recolecciones (v_recoleccion_detalle). El registro llega con la sincronización móvil (Fase 2)."""
from datetime import date

from fastapi import APIRouter, Depends, Query

from .. import db
from ..deps import Usuario, solo_admin
from ..esquemas.recolecciones import RecoleccionDetalle

router = APIRouter(prefix="/recolecciones", tags=["recolecciones"])


def buscar(conn, *, desde: date | None = None, hasta: date | None = None, ruta_id: int | None = None,
           productor_id: int | None = None, registrado_por: int | None = None,
           incluir_anuladas: bool = False, limit: int = 200, offset: int = 0) -> list[dict]:
    return db.todos(conn, """
        SELECT * FROM v_recoleccion_detalle
         WHERE (%(desde)s::date IS NULL OR fecha >= %(desde)s)
           AND (%(hasta)s::date IS NULL OR fecha <= %(hasta)s)
           AND (%(ruta)s::bigint IS NULL OR ruta_id = %(ruta)s)
           AND (%(prod)s::bigint IS NULL OR productor_id = %(prod)s)
           AND (%(reg)s::bigint IS NULL OR registrado_por = %(reg)s)
           AND (%(anuladas)s OR anulada_en IS NULL)
         ORDER BY registrada_en DESC
         LIMIT %(limit)s OFFSET %(offset)s
    """, {"desde": desde, "hasta": hasta, "ruta": ruta_id, "prod": productor_id, "reg": registrado_por,
          "anuladas": incluir_anuladas, "limit": limit, "offset": offset})


@router.get("", response_model=list[RecoleccionDetalle])
def listar(desde: date | None = None, hasta: date | None = None, ruta_id: int | None = None,
           productor_id: int | None = None, registrado_por: int | None = None, incluir_anuladas: bool = False,
           limit: int = Query(200, ge=1, le=1000), offset: int = Query(0, ge=0),
           usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        return buscar(conn, desde=desde, hasta=hasta, ruta_id=ruta_id, productor_id=productor_id,
                      registrado_por=registrado_por, incluir_anuladas=incluir_anuladas, limit=limit, offset=offset)
