"""Reportes del analista desde el celular: solo informativos (foto de un productor). No registran valores de calidad
ni generan sanciones; la decisión es del administrador.

La base no tiene una tabla de reportes por productor (CLAUDE.md: no se crean tablas sin aprobación), así que la foto
se asocia a la entrega más reciente del productor que todavía no tiene análisis: una fila de analisis_calidad solo con
foto_url (no cambia estado_calidad ni toca un análisis existente). El archivo se llama reporte-<uuid_reporte>, lo que
hace la subida idempotente y distingue estos reportes de las fotos de una revisión de calidad.

Pendiente de estructura (docs): el comentario del analista no tiene columna donde guardarse; queda en el celular.
"""
from datetime import date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from pydantic import BaseModel

from .. import db
from ..config import config
from ..deps import Usuario, requiere_rol, solo_admin
from ..errores import ErrorApi, validacion
from .analisis import CARPETA, _extension, _raiz

router = APIRouter(prefix="/analista", tags=["reportes del analista"])

solo_analista = requiere_rol("analista")
PREFIJO = f"{CARPETA}/reporte-"


class ReporteGuardado(BaseModel):
    uuid_reporte: UUID
    estado: str                      # creado | duplicado
    recoleccion_id: UUID
    foto_url: str
    creado_en: datetime


class Reporte(BaseModel):
    recoleccion_id: UUID
    creado_en: datetime
    productor_id: int
    productor_codigo: str
    productor: str
    tipo_productor: str
    ruta: str | None
    entrega_registrada_en: datetime
    foto_url: str


def sin_entrega(mensaje: str) -> ErrorApi:
    """409 transitorio: el celular conserva el reporte y lo reintenta en la siguiente sincronización."""
    return ErrorApi(409, "sin_entrega", mensaje)


@router.post("/reportes", response_model=ReporteGuardado)
def subir_reporte(uuid_reporte: UUID = Form(...), productor_id: int | None = Form(None),
                  productor_uuid_cliente: UUID | None = Form(None), foto: UploadFile = File(...),
                  usuario: Usuario = Depends(solo_analista)):
    if (productor_id is None) == (productor_uuid_cliente is None):
        raise validacion("Indique productor_id o productor_uuid_cliente (solo uno)")
    maximo = config().foto_max_mb * 1024 * 1024
    contenido = foto.file.read(maximo + 1)
    if len(contenido) > maximo:
        raise ErrorApi(413, "muy_grande", f"La foto supera el límite de {config().foto_max_mb} MB")
    ext = _extension(contenido)
    if ext is None:
        raise validacion("El archivo debe ser una imagen JPEG, PNG o WebP")

    with db.transaccion(usuario.id) as conn:
        previo = db.uno(conn, "SELECT recoleccion_id, foto_url, creado_en FROM analisis_calidad WHERE foto_url LIKE %s",
                        (f"{PREFIJO}{uuid_reporte}.%",))
        if previo is not None:
            return ReporteGuardado(uuid_reporte=uuid_reporte, estado="duplicado", **previo)

        productor = db.uno(conn, """
            SELECT id FROM productor
             WHERE (%(id)s::bigint IS NOT NULL AND id = %(id)s) OR (%(uuid)s::uuid IS NOT NULL AND uuid_cliente = %(uuid)s)
        """, {"id": productor_id, "uuid": productor_uuid_cliente})
        if productor is None:
            raise sin_entrega("El productor todavía no está en el servidor. Se reintentará")
        # Un reporte a la vez por productor: dos subidas simultáneas no eligen la misma entrega
        conn.execute("SELECT pg_advisory_xact_lock(hashtext('reporte_analista'), %s::int)", (productor["id"] % 2_000_000_000,))
        entrega = db.uno(conn, """
            SELECT r.id FROM recoleccion r
             WHERE r.productor_id = %s AND r.anulada_en IS NULL
               AND NOT EXISTS (SELECT 1 FROM analisis_calidad a WHERE a.recoleccion_id = r.id)
             ORDER BY r.registrada_en DESC LIMIT 1
        """, (productor["id"],))
        if entrega is None:
            raise sin_entrega("El productor no tiene una entrega libre para asociar la foto. Se reintentará "
                              "cuando entregue leche")

        relativa = f"{PREFIJO}{uuid_reporte}.{ext}"
        destino = _raiz() / relativa
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_bytes(contenido)
        try:
            fila = db.uno(conn, """
                INSERT INTO analisis_calidad (recoleccion_id, foto_url) VALUES (%s, %s)
                RETURNING recoleccion_id, foto_url, creado_en
            """, (entrega["id"], relativa))
        except Exception:
            destino.unlink(missing_ok=True)
            raise
    return ReporteGuardado(uuid_reporte=uuid_reporte, estado="creado", **fila)


@router.get("/reportes", response_model=list[Reporte])
def listar_reportes(desde: date | None = None, hasta: date | None = None, limit: int = Query(200, ge=1, le=1000),
                    usuario: Usuario = Depends(solo_admin)):
    """Los más recientes primero. La foto se ve con GET /analisis/{recoleccion_id}/foto."""
    with db.transaccion(usuario.id) as conn:
        return db.todos(conn, """
            SELECT a.recoleccion_id, a.creado_en, p.id AS productor_id, p.codigo AS productor_codigo,
                   p.nombre AS productor, p.tipo::text AS tipo_productor, rt.nombre AS ruta,
                   r.registrada_en AS entrega_registrada_en, a.foto_url
              FROM analisis_calidad a
              JOIN recoleccion r ON r.id = a.recoleccion_id
              JOIN productor p   ON p.id = r.productor_id
              LEFT JOIN ruta rt  ON rt.id = p.ruta_id
             WHERE a.foto_url LIKE %(prefijo)s
               AND (%(desde)s::date IS NULL OR (a.creado_en AT TIME ZONE 'America/Lima')::date >= %(desde)s)
               AND (%(hasta)s::date IS NULL OR (a.creado_en AT TIME ZONE 'America/Lima')::date <= %(hasta)s)
             ORDER BY a.creado_en DESC
             LIMIT %(limit)s
        """, {"prefijo": f"{PREFIJO}%", "desde": desde, "hasta": hasta, "limit": limit})
