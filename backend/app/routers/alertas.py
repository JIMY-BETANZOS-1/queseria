"""Alertas de sospecha de las recolecciones (pantalla Mapa / Recolecciones del admin).

Revisar una alerta que retiene el pago (productor_bloqueado, firma_invalida) lo libera: lo decide
v_recoleccion_pago, que solo retiene por alertas sin revisar.
"""
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from .. import db
from ..deps import Usuario, solo_admin
from ..errores import conflicto, no_encontrado
from ..esquemas.alertas import Alerta, RevisarAlerta

router = APIRouter(prefix="/alertas", tags=["alertas"])

SELECT_ALERTA = """
    SELECT a.id, a.recoleccion_id, a.tipo::text AS tipo, a.detalle, a.creada_en,
           a.revisada_por, a.revisada_en, a.resolucion,
           d.fecha, d.registrada_en, d.productor_id, d.productor_codigo, d.productor,
           d.registrado_por, d.registrado_por_nombre, d.color_hex, d.litros,
           d.retenida AS recoleccion_retenida
      FROM alerta_recoleccion a
      JOIN v_recoleccion_detalle d ON d.recoleccion_id = a.recoleccion_id
"""


@router.get("", response_model=list[Alerta])
def listar(todas: bool = False, tipo: str | None = None, recoleccion_id: UUID | None = None,
           limit: int = Query(200, ge=1, le=1000), offset: int = Query(0, ge=0),
           usuario: Usuario = Depends(solo_admin)):
    """Por defecto solo las pendientes (sin revisar), las más antiguas primero."""
    with db.transaccion(usuario.id) as conn:
        return db.todos(conn, SELECT_ALERTA + """
             WHERE (%(todas)s OR a.revisada_en IS NULL)
               AND (%(tipo)s::text IS NULL OR a.tipo::text = %(tipo)s)
               AND (%(rec)s::uuid IS NULL OR a.recoleccion_id = %(rec)s)
             ORDER BY a.creada_en, a.id
             LIMIT %(limit)s OFFSET %(offset)s
        """, {"todas": todas, "tipo": tipo, "rec": recoleccion_id, "limit": limit, "offset": offset})


@router.post("/{alerta_id}/revisar", response_model=Alerta)
def revisar(alerta_id: int, datos: RevisarAlerta, usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        fila = db.uno(conn, """
            UPDATE alerta_recoleccion SET revisada_por = %s, revisada_en = now(), resolucion = %s
             WHERE id = %s AND revisada_en IS NULL RETURNING id
        """, (usuario.id, datos.resolucion, alerta_id))
        if fila is None:
            if db.uno(conn, "SELECT 1 FROM alerta_recoleccion WHERE id = %s", (alerta_id,)) is None:
                raise no_encontrado("La alerta no existe")
            raise conflicto("La alerta ya fue revisada")
        return db.uno(conn, SELECT_ALERTA + " WHERE a.id = %s", (alerta_id,))
