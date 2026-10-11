"""Pantalla "Mi día" del acopiador: lo que registró hoy (hora de Lima), según el servidor."""
from fastapi import APIRouter, Depends

from .. import db
from ..deps import Usuario, requiere_rol
from ..esquemas.sync import MiDia
from .rutas import HOY_LIMA

router = APIRouter(prefix="/acopiador", tags=["acopiador"])


@router.get("/mi-dia", response_model=MiDia)
def mi_dia(usuario: Usuario = Depends(requiere_rol("acopiador"))):
    with db.transaccion(usuario.id) as conn:
        fecha = db.uno(conn, f"SELECT {HOY_LIMA} AS hoy")["hoy"]
        filas = db.todos(conn, """
            SELECT recoleccion_id, registrada_en, productor_id, productor_codigo, productor, litros,
                   estado_calidad, revisada, anulada_en
              FROM v_recoleccion_detalle
             WHERE registrado_por = %s AND fecha = %s
             ORDER BY registrada_en
        """, (usuario.id, fecha))
    vigentes = [f for f in filas if f["anulada_en"] is None]
    return MiDia(fecha=fecha, total_litros=sum(f["litros"] for f in vigentes), n_recolecciones=len(vigentes),
                 recolecciones=filas)
