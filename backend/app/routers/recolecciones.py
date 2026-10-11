"""Recolecciones (v_recoleccion_detalle) y su anulación. El registro llega por /sync/push."""
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from .. import db
from ..deps import Usuario, solo_admin
from ..errores import conflicto, no_encontrado
from ..esquemas.alertas import AnularRecoleccion
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


@router.post("/{recoleccion_id}/anular", response_model=RecoleccionDetalle)
def anular(recoleccion_id: UUID, datos: AnularRecoleccion, usuario: Usuario = Depends(solo_admin)):
    """Nunca se borra: queda con motivo. Si originó una sanción, el trigger de la base la levanta."""
    with db.transaccion(usuario.id) as conn:
        fila = db.uno(conn, """
            UPDATE recoleccion SET anulada_en = now(), anulada_por = %s, motivo_anulacion = %s
             WHERE id = %s AND anulada_en IS NULL RETURNING id
        """, (usuario.id, datos.motivo, recoleccion_id))
        if fila is None:
            if db.uno(conn, "SELECT 1 FROM recoleccion WHERE id = %s", (recoleccion_id,)) is None:
                raise no_encontrado("La recolección no existe")
            raise conflicto("La recolección ya está anulada")
        return db.uno(conn, "SELECT * FROM v_recoleccion_detalle WHERE recoleccion_id = %s", (recoleccion_id,))
