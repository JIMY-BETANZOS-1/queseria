"""Recolecciones (v_recoleccion_detalle), su anulación y la revisión de calidad del admin.
El registro llega por /sync/push."""
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from .. import db
from ..deps import Usuario, solo_admin
from ..errores import conflicto, no_encontrado
from ..esquemas.alertas import AnularRecoleccion
from ..esquemas.recolecciones import CalidadAdmin, CalidadRevisada, RecoleccionDetalle
from ..esquemas.sync import RevisionCalidad
from .sync import _revisar

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


# ----------------------------------------------------------------- calidad (admin)
@router.get("/sin-revisar", response_model=list[RecoleccionDetalle])
def sin_revisar(desde: date | None = None, hasta: date | None = None, registrado_por: int | None = None,
                limit: int = Query(500, ge=1, le=1000), usuario: Usuario = Depends(solo_admin)):
    """Lista de trabajo de calidad (v_recoleccion_sin_revisar), con el detalle de cada una; las más antiguas primero."""
    with db.transaccion(usuario.id) as conn:
        return db.todos(conn, """
            SELECT d.* FROM v_recoleccion_detalle d
              JOIN v_recoleccion_sin_revisar s ON s.recoleccion_id = d.recoleccion_id
             WHERE (%(desde)s::date IS NULL OR d.fecha >= %(desde)s)
               AND (%(hasta)s::date IS NULL OR d.fecha <= %(hasta)s)
               AND (%(reg)s::bigint IS NULL OR d.registrado_por = %(reg)s)
             ORDER BY d.registrada_en
             LIMIT %(limit)s
        """, {"desde": desde, "hasta": hasta, "reg": registrado_por, "limit": limit})


@router.post("/{recoleccion_id}/calidad", response_model=CalidadRevisada)
def revisar_calidad(recoleccion_id: UUID, datos: CalidadAdmin, usuario: Usuario = Depends(solo_admin)):
    """El admin revisa como lo haría el analista (misma lógica que /sync/calidad; la base acepta al admin en
    calidad_por). Alterado sin análisis, o un análisis fuera de rango, lo rechaza la base."""
    resultado = _revisar(usuario, RevisionCalidad(recoleccion_id=recoleccion_id, **datos.model_dump()))
    if resultado["estado"] == "rechazado":
        if resultado["motivo"] == "La recolección no existe":
            raise no_encontrado(resultado["motivo"])
        raise conflicto(resultado["motivo"])
    if resultado["estado"] == "duplicado":
        raise conflicto("La recolección ya estaba revisada")
    with db.transaccion(usuario.id) as conn:
        detalle = db.uno(conn, "SELECT * FROM v_recoleccion_detalle WHERE recoleccion_id = %s", (recoleccion_id,))
    return {"recoleccion": detalle, "sancion": resultado["sancion"]}
