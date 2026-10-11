"""Usuario autenticado y control de roles."""
from dataclasses import dataclass

import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import db, seguridad
from .errores import ErrorApi

_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class Usuario:
    id: int
    rol: str
    nombre: str
    dispositivo_id: int | None = None


def no_autorizado(mensaje: str = "Debe iniciar sesión") -> ErrorApi:
    return ErrorApi(401, "no_autorizado", mensaje)


def usuario_actual(cred: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> Usuario:
    if cred is None:
        raise no_autorizado()
    try:
        datos = seguridad.leer_token(cred.credentials)
        usuario_id = int(datos["sub"])
    except (jwt.InvalidTokenError, ValueError, KeyError):
        raise no_autorizado("Sesión inválida o vencida")
    dispositivo_id = datos.get("dis")

    # Se revisa en cada petición: desactivar un usuario o un celular corta el acceso al instante
    with db.pool().connection() as conn:
        fila = db.uno(conn, """
            SELECT u.id, u.rol::text AS rol, u.nombre_completo
              FROM usuario u
             WHERE u.id = %(u)s AND u.activo
               AND (%(d)s::bigint IS NULL OR EXISTS (
                     SELECT 1 FROM dispositivo d
                      WHERE d.id = %(d)s AND d.usuario_id = u.id AND d.activo))
        """, {"u": usuario_id, "d": dispositivo_id})
    if fila is None:
        raise no_autorizado("Usuario o celular desactivado")
    if fila["rol"] != "admin" and dispositivo_id is None:
        raise no_autorizado("Sesión inválida")
    return Usuario(fila["id"], fila["rol"], fila["nombre_completo"], dispositivo_id)


def requiere_rol(*roles: str):
    def dependencia(usuario: Usuario = Depends(usuario_actual)) -> Usuario:
        if usuario.rol not in roles:
            raise ErrorApi(403, "prohibido", "No tiene permiso para esta operación")
        return usuario
    return dependencia


solo_admin = requiere_rol("admin")
solo_movil = requiere_rol("acopiador", "analista")
