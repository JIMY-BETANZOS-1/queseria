"""Productores (pantalla Proveedores): lectura desde v_productor_resumen, edición sobre la tabla."""
from datetime import date

from fastapi import APIRouter, Depends, Query

from .. import db
from ..deps import Usuario, solo_admin
from ..errores import no_encontrado
from ..esquemas.productores import (Productor, ProductorCambios, ProductorNuevo, ProductorObservado,
                                    ProductorResumen, TipoProductor)
from ..esquemas.recolecciones import RecoleccionDetalle
from . import recolecciones

router = APIRouter(prefix="/productores", tags=["productores"])


def _productor(conn, productor_id: int) -> dict:
    fila = db.uno(conn, "SELECT * FROM productor WHERE id = %s", (productor_id,))
    if fila is None:
        raise no_encontrado("El productor no existe")
    return fila


@router.get("", response_model=list[ProductorResumen])
def listar(tipo: TipoProductor | None = None, ruta_id: int | None = None, pendiente: bool | None = None,
           q: str | None = None, incluir_inactivos: bool = False, usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        return db.todos(conn, """
            SELECT v.*, p.activo
              FROM v_productor_resumen v JOIN productor p ON p.id = v.productor_id
             WHERE (%(tipo)s::tipo_productor IS NULL OR v.tipo = %(tipo)s)
               AND (%(ruta)s::bigint IS NULL OR v.ruta_id = %(ruta)s)
               AND (%(pend)s::boolean IS NULL OR v.pendiente_aprobacion = %(pend)s)
               AND (%(q)s::text IS NULL OR v.nombre ILIKE '%%' || %(q)s || '%%' OR v.codigo ILIKE %(q)s)
               AND (%(inact)s OR p.activo)
             ORDER BY v.pendiente_aprobacion DESC, v.nombre
        """, {"tipo": tipo, "ruta": ruta_id, "pend": pendiente, "q": q, "inact": incluir_inactivos})


@router.get("/observados", response_model=list[ProductorObservado])
def observados(usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        return db.todos(conn, "SELECT * FROM v_productor_observado ORDER BY estado, sancion_hasta, nombre")


@router.post("", response_model=Productor, status_code=201)
def crear(datos: ProductorNuevo, usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        return db.uno(conn, """
            INSERT INTO productor (nombre, documento, celular, tipo, ruta_id, latitud_ref, longitud_ref, creado_por)
            VALUES (%(nombre)s, %(documento)s, %(celular)s, %(tipo)s, %(ruta_id)s, %(latitud_ref)s,
                    %(longitud_ref)s, %(creado_por)s)
            RETURNING *
        """, {**datos.model_dump(), "creado_por": usuario.id})


@router.get("/{productor_id}", response_model=Productor)
def obtener(productor_id: int, usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        return _productor(conn, productor_id)


@router.patch("/{productor_id}", response_model=Productor)
def editar(productor_id: int, datos: ProductorCambios, usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        fila = db.actualizar(conn, "productor", "id", productor_id, datos.model_dump(exclude_unset=True))
        if fila is None:
            raise no_encontrado("El productor no existe")
        return fila


@router.post("/{productor_id}/aprobar", response_model=Productor)
def aprobar(productor_id: int, usuario: Usuario = Depends(solo_admin)):
    """Aprueba un alta de campo: su leche deja de quedar retenida por "no aprobado" (lo decide la base)."""
    with db.transaccion(usuario.id) as conn:
        fila = db.actualizar(conn, "productor", "id", productor_id, {"aprobado": True})
        if fila is None:
            raise no_encontrado("El productor no existe")
        return fila


@router.get("/{productor_id}/recolecciones", response_model=list[RecoleccionDetalle])
def historial(productor_id: int, desde: date | None = None, hasta: date | None = None,
              limit: int = Query(200, ge=1, le=1000), offset: int = Query(0, ge=0),
              usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        _productor(conn, productor_id)
        return recolecciones.buscar(conn, productor_id=productor_id, desde=desde, hasta=hasta,
                                    limit=limit, offset=offset)
