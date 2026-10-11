"""Rutas y su asignación a acopiadores (con historial en ruta_acopiador)."""
from fastapi import APIRouter, Depends, Query

from .. import db
from ..deps import Usuario, solo_admin
from ..errores import no_encontrado
from ..esquemas.rutas import Asignacion, Asignar, Ruta, RutaCambios, RutaNueva

router = APIRouter(prefix="/rutas", tags=["rutas"])

SELECT_RUTA = """
    SELECT r.id, r.nombre, r.descripcion, r.activa, r.actualizado_en,
           ra.acopiador_id, u.nombre_completo AS acopiador, a.color_hex
      FROM ruta r
      LEFT JOIN ruta_acopiador ra ON ra.ruta_id = r.id AND ra.vigente_hasta IS NULL
      LEFT JOIN acopiador a       ON a.usuario_id = ra.acopiador_id
      LEFT JOIN usuario u         ON u.id = ra.acopiador_id
"""

HOY_LIMA = "(now() AT TIME ZONE 'America/Lima')::date"


def _ruta(conn, ruta_id: int) -> dict:
    fila = db.uno(conn, SELECT_RUTA + " WHERE r.id = %s", (ruta_id,))
    if fila is None:
        raise no_encontrado("La ruta no existe")
    return fila


@router.get("", response_model=list[Ruta])
def listar(activa: bool | None = None, usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        return db.todos(conn, SELECT_RUTA + " WHERE %(a)s::boolean IS NULL OR r.activa = %(a)s ORDER BY r.nombre",
                        {"a": activa})


@router.post("", response_model=Ruta, status_code=201)
def crear(datos: RutaNueva, usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        fila = db.uno(conn, "INSERT INTO ruta (nombre, descripcion) VALUES (%s, %s) RETURNING id",
                      (datos.nombre, datos.descripcion))
        return _ruta(conn, fila["id"])


@router.get("/{ruta_id}", response_model=Ruta)
def obtener(ruta_id: int, usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        return _ruta(conn, ruta_id)


@router.patch("/{ruta_id}", response_model=Ruta)
def editar(ruta_id: int, datos: RutaCambios, usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        if db.actualizar(conn, "ruta", "id", ruta_id, datos.model_dump(exclude_unset=True)) is None:
            raise no_encontrado("La ruta no existe")
        return _ruta(conn, ruta_id)


@router.put("/{ruta_id}/acopiador", response_model=Asignacion)
def asignar_acopiador(ruta_id: int, datos: Asignar, usuario: Usuario = Depends(solo_admin)):
    """Asigna o reasigna: cierra la asignación vigente (vigente_hasta = desde) y abre la nueva desde esa fecha."""
    with db.transaccion(usuario.id) as conn:
        if db.uno(conn, "SELECT 1 FROM ruta WHERE id = %s FOR UPDATE", (ruta_id,)) is None:
            raise no_encontrado("La ruta no existe")
        p = {"ruta": ruta_id, "acop": datos.acopiador_id, "desde": datos.desde}
        vigente = db.uno(conn, "SELECT id, acopiador_id FROM ruta_acopiador WHERE ruta_id = %s AND vigente_hasta IS NULL",
                         (ruta_id,))
        if vigente is not None and vigente["acopiador_id"] == datos.acopiador_id:
            nueva_id = vigente["id"]
        else:
            conn.execute(f"""
                UPDATE ruta_acopiador SET vigente_hasta = COALESCE(%(desde)s, {HOY_LIMA})
                 WHERE ruta_id = %(ruta)s AND vigente_hasta IS NULL
            """, p)
            nueva_id = db.uno(conn, f"""
                INSERT INTO ruta_acopiador (ruta_id, acopiador_id, vigente_desde)
                VALUES (%(ruta)s, %(acop)s, COALESCE(%(desde)s, {HOY_LIMA})) RETURNING id
            """, p)["id"]
        return db.uno(conn, """
            SELECT ra.*, u.nombre_completo AS acopiador
              FROM ruta_acopiador ra JOIN usuario u ON u.id = ra.acopiador_id WHERE ra.id = %s
        """, (nueva_id,))


@router.delete("/{ruta_id}/acopiador", response_model=Asignacion)
def quitar_acopiador(ruta_id: int, usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        fila = db.uno(conn, f"""
            UPDATE ruta_acopiador SET vigente_hasta = GREATEST(vigente_desde, {HOY_LIMA})
             WHERE ruta_id = %s AND vigente_hasta IS NULL RETURNING id
        """, (ruta_id,))
        if fila is None:
            raise no_encontrado("La ruta no tiene acopiador vigente")
        return db.uno(conn, """
            SELECT ra.*, u.nombre_completo AS acopiador
              FROM ruta_acopiador ra JOIN usuario u ON u.id = ra.acopiador_id WHERE ra.id = %s
        """, (fila["id"],))


@router.get("/{ruta_id}/asignaciones", response_model=list[Asignacion])
def historial(ruta_id: int, limit: int = Query(100, ge=1, le=1000), usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        _ruta(conn, ruta_id)
        return db.todos(conn, """
            SELECT ra.*, u.nombre_completo AS acopiador
              FROM ruta_acopiador ra JOIN usuario u ON u.id = ra.acopiador_id
             WHERE ra.ruta_id = %s
             ORDER BY ra.vigente_hasta IS NULL DESC, ra.vigente_desde DESC, ra.id DESC
             LIMIT %s
        """, (ruta_id, limit))
