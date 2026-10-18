"""Pantallas "Mi día" y "Últimos días" del acopiador: lo que registró (hora de Lima), según el servidor."""
from datetime import date, timedelta

from fastapi import APIRouter, Depends

from .. import db
from ..deps import Usuario, requiere_rol
from ..esquemas.sync import MiDia
from .rutas import HOY_LIMA

router = APIRouter(prefix="/acopiador", tags=["acopiador"])

# Hoy y los 6 días anteriores: la semana de liquidación y lo que el celular conserva de lo ya enviado
DIAS_HISTORIAL = 7

_COLUMNAS = """recoleccion_id, registrada_en, productor_id, productor_codigo, productor, litros,
               estado_calidad, revisada, anulada_en, fecha"""


def _resumen(fecha: date, filas: list[dict]) -> MiDia:
    """Las anuladas se muestran en la lista, pero no suman."""
    vigentes = [f for f in filas if f["anulada_en"] is None]
    return MiDia(fecha=fecha, total_litros=sum(f["litros"] for f in vigentes), n_recolecciones=len(vigentes),
                 recolecciones=filas)


@router.get("/mi-dia", response_model=MiDia)
def mi_dia(usuario: Usuario = Depends(requiere_rol("acopiador"))):
    with db.transaccion(usuario.id) as conn:
        fecha = db.uno(conn, f"SELECT {HOY_LIMA} AS hoy")["hoy"]
        filas = db.todos(conn, f"""
            SELECT {_COLUMNAS}
              FROM v_recoleccion_detalle
             WHERE registrado_por = %s AND fecha = %s
             ORDER BY registrada_en
        """, (usuario.id, fecha))
    return _resumen(fecha, filas)


@router.get("/ultimos-dias", response_model=list[MiDia])
def ultimos_dias(usuario: Usuario = Depends(requiere_rol("acopiador"))):
    """Un elemento por día, de hoy hacia atrás, incluidos los días sin entregas."""
    with db.transaccion(usuario.id) as conn:
        hoy = db.uno(conn, f"SELECT {HOY_LIMA} AS hoy")["hoy"]
        desde = hoy - timedelta(days=DIAS_HISTORIAL - 1)
        filas = db.todos(conn, f"""
            SELECT {_COLUMNAS}
              FROM v_recoleccion_detalle
             WHERE registrado_por = %s AND fecha BETWEEN %s AND %s
             ORDER BY registrada_en
        """, (usuario.id, desde, hoy))
    por_dia: dict[date, list[dict]] = {}
    for f in filas:
        por_dia.setdefault(f["fecha"], []).append(f)
    return [_resumen(d, por_dia.get(d, [])) for d in (hoy - timedelta(days=i) for i in range(DIAS_HISTORIAL))]
