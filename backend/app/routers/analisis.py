"""Foto del análisis de calidad: se sube aparte (multipart) y se guarda en storage/ (fuera de git).

La foto puede subirse antes o después de la revisión: se hace upsert de analisis_calidad.foto_url.
Para marcar una alterada solo con foto, el celular sube primero la foto y luego envía /sync/calidad.
"""
import secrets
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .. import db
from ..config import config
from ..deps import Usuario, requiere_rol
from ..errores import ErrorApi, no_encontrado, validacion

router = APIRouter(prefix="/analisis", tags=["análisis de calidad"])

analista_o_admin = requiere_rol("analista", "admin")

CARPETA = "analisis"
# Se reconoce el formato por los primeros bytes (no se confía en el content-type del cliente)
FIRMAS_IMAGEN = {
    "jpg": (b"\xff\xd8\xff",),
    "png": (b"\x89PNG\r\n\x1a\n",),
}
TIPOS_MEDIA = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}


class FotoGuardada(BaseModel):
    recoleccion_id: UUID
    foto_url: str


def _extension(contenido: bytes) -> str | None:
    if contenido[:4] == b"RIFF" and contenido[8:12] == b"WEBP":
        return "webp"
    return next((ext for ext, firmas in FIRMAS_IMAGEN.items() if contenido.startswith(firmas)), None)


def _raiz() -> Path:
    return Path(config().storage_dir).resolve()


@router.post("/{recoleccion_id}/foto", response_model=FotoGuardada)
def subir_foto(recoleccion_id: UUID, archivo: UploadFile = File(...), usuario: Usuario = Depends(analista_o_admin)):
    maximo = config().foto_max_mb * 1024 * 1024
    contenido = archivo.file.read(maximo + 1)
    if len(contenido) > maximo:
        raise ErrorApi(413, "muy_grande", f"La foto supera el límite de {config().foto_max_mb} MB")
    ext = _extension(contenido)
    if ext is None:
        raise validacion("El archivo debe ser una imagen JPEG, PNG o WebP")

    with db.transaccion(usuario.id) as conn:
        if db.uno(conn, "SELECT 1 FROM recoleccion WHERE id = %s", (recoleccion_id,)) is None:
            raise no_encontrado("La recolección no existe")
        relativa = f"{CARPETA}/{recoleccion_id}-{secrets.token_hex(6)}.{ext}"
        destino = _raiz() / relativa
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_bytes(contenido)
        try:
            conn.execute("""
                INSERT INTO analisis_calidad (recoleccion_id, foto_url) VALUES (%s, %s)
                ON CONFLICT (recoleccion_id) DO UPDATE SET foto_url = EXCLUDED.foto_url
            """, (recoleccion_id, relativa))
        except Exception:
            destino.unlink(missing_ok=True)
            raise
    return FotoGuardada(recoleccion_id=recoleccion_id, foto_url=relativa)


@router.get("/{recoleccion_id}/foto")
def ver_foto(recoleccion_id: UUID, usuario: Usuario = Depends(analista_o_admin)):
    with db.transaccion(usuario.id) as conn:
        fila = db.uno(conn, "SELECT foto_url FROM analisis_calidad WHERE recoleccion_id = %s", (recoleccion_id,))
    if fila is None or not fila["foto_url"]:
        raise no_encontrado("La recolección no tiene foto")
    raiz = _raiz()
    ruta = (raiz / fila["foto_url"]).resolve()
    if raiz not in ruta.parents or not ruta.is_file():
        raise no_encontrado("La foto no está disponible")
    return FileResponse(ruta, media_type=TIPOS_MEDIA.get(ruta.suffix.lstrip("."), "application/octet-stream"))
