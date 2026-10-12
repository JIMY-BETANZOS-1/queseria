"""Autenticación: admin (correo + contraseña) y móvil (código de activación + PIN)."""
import threading
import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, Request

from .. import db, seguridad
from ..config import config
from ..deps import Usuario, no_autorizado, solo_movil
from ..errores import ErrorApi, conflicto
from ..esquemas.auth import (Activar, CambiarPin, DispositivoActivado, LoginAdmin, LoginPin, Token,
                             TokenMovil, UsuarioSesion)

router = APIRouter(prefix="/auth", tags=["autenticación"])

# Límite de códigos de activación fallidos por IP (codigo_activacion no tiene contador de intentos)
ACTIVAR_MAX_FALLOS = 10
ACTIVAR_VENTANA_S = 600
_fallos_activar: dict[str, deque] = defaultdict(deque)
_candado = threading.Lock()


def _fallos_recientes(ip: str) -> deque:
    cola = _fallos_activar[ip]
    limite = time.monotonic() - ACTIVAR_VENTANA_S
    while cola and cola[0] < limite:
        cola.popleft()
    return cola


def reiniciar_limites() -> None:
    with _candado:
        _fallos_activar.clear()


@router.post("/admin/login", response_model=Token)
def login_admin(datos: LoginAdmin):
    with db.pool().connection() as conn:
        fila = db.uno(conn, """
            SELECT id, nombre_completo, password_hash FROM usuario
             WHERE lower(email) = lower(%s) AND rol = 'admin' AND activo
        """, (datos.email,))
    # Con correo inexistente se compara igual contra un hash de relleno (mismo tiempo de respuesta)
    if not seguridad.verificar(datos.password, fila["password_hash"] if fila else None) or fila is None:
        raise no_autorizado("Correo o contraseña incorrectos")
    minutos = config().jwt_minutos_admin
    return Token(
        access_token=seguridad.crear_token(fila["id"], "admin", minutos),
        expira_en_min=minutos,
        usuario=UsuarioSesion(id=fila["id"], rol="admin", nombre_completo=fila["nombre_completo"]),
    )


@router.post("/dispositivo/activar", response_model=DispositivoActivado)
def activar_dispositivo(datos: Activar, request: Request):
    ip = request.client.host if request.client else "?"
    with _candado:
        if len(_fallos_recientes(ip)) >= ACTIVAR_MAX_FALLOS:
            raise ErrorApi(429, "demasiados_intentos", "Demasiados códigos incorrectos. Intente en unos minutos")

    with db.transaccion(None) as conn:
        codigo = db.uno(conn, """
            SELECT c.id, u.id AS usuario_id, u.rol::text AS rol, u.nombre_completo, u.activo
              FROM codigo_activacion c JOIN usuario u ON u.id = c.usuario_id
             WHERE c.codigo_hash = %s AND c.usado_en IS NULL AND c.expira_en > now()
               FOR UPDATE OF c
        """, (seguridad.hash_codigo(datos.codigo),))
        if codigo is not None and codigo["activo"] and codigo["rol"] in ("acopiador", "analista"):
            uid = codigo["usuario_id"]
            db.fijar_usuario(conn, uid)
            conn.execute("UPDATE codigo_activacion SET usado_en = now() WHERE id = %s", (codigo["id"],))

            existente = db.uno(conn, "SELECT id, usuario_id FROM dispositivo WHERE device_uuid = %s FOR UPDATE",
                               (datos.device_uuid,))
            if existente is not None and existente["usuario_id"] != uid:
                raise conflicto("Este celular ya está vinculado a otro usuario")
            # Un solo celular activo por usuario: el anterior queda desactivado
            conn.execute("UPDATE dispositivo SET activo = false WHERE usuario_id = %s AND activo AND device_uuid <> %s",
                         (uid, datos.device_uuid))
            if existente is not None:
                disp = db.uno(conn, """
                    UPDATE dispositivo SET activo = true, clave_publica = %s, modelo = %s, activado_en = now()
                     WHERE id = %s RETURNING id, activado_en
                """, (datos.clave_publica, datos.modelo, existente["id"]))
            else:
                disp = db.uno(conn, """
                    INSERT INTO dispositivo (usuario_id, device_uuid, modelo, clave_publica)
                    VALUES (%s, %s, %s, %s) RETURNING id, activado_en
                """, (uid, datos.device_uuid, datos.modelo, datos.clave_publica))
            return DispositivoActivado(
                dispositivo_id=disp["id"], activado_en=disp["activado_en"],
                usuario=UsuarioSesion(id=uid, rol=codigo["rol"], nombre_completo=codigo["nombre_completo"]),
            )

    with _candado:
        _fallos_recientes(ip).append(time.monotonic())
    raise no_autorizado("Código inválido, vencido o ya usado")


def _registrar_fallo_pin(conn, usuario_id: int) -> dict:
    """Suma un intento fallido; al llegar al máximo bloquea el PIN por unos minutos y reinicia el contador."""
    cfg = config()
    return db.uno(conn, """
        UPDATE usuario
           SET pin_intentos_fallidos = CASE WHEN pin_intentos_fallidos + 1 >= %(max)s THEN 0
                                            ELSE pin_intentos_fallidos + 1 END,
               bloqueado_hasta = CASE WHEN pin_intentos_fallidos + 1 >= %(max)s
                                      THEN now() + make_interval(mins => %(min)s) ELSE bloqueado_hasta END
         WHERE id = %(id)s
     RETURNING pin_intentos_fallidos,
               COALESCE(bloqueado_hasta > now(), false) AS bloqueado,
               to_char(bloqueado_hasta AT TIME ZONE 'America/Lima', 'HH24:MI') AS hasta
    """, {"max": cfg.pin_max_intentos, "min": cfg.pin_bloqueo_min, "id": usuario_id})


def _error_fallo_pin(fallo: dict) -> ErrorApi:
    if fallo["bloqueado"]:
        return ErrorApi(423, "bloqueado", f"Demasiados intentos. PIN bloqueado hasta las {fallo['hasta']}")
    quedan = config().pin_max_intentos - fallo["pin_intentos_fallidos"]
    return ErrorApi(401, "pin_incorrecto", f"PIN incorrecto. Le quedan {quedan} intentos")


@router.post("/pin/login", response_model=TokenMovil)
def login_pin(datos: LoginPin):
    error: ErrorApi | None = None
    # El fallo se guarda (COMMIT) antes de responder el error
    with db.transaccion(None) as conn:
        fila = db.uno(conn, """
            SELECT u.id, u.rol::text AS rol, u.nombre_completo, u.pin_hash,
                   (u.pin_actualizado_en IS NULL) AS debe_cambiar_pin,
                   COALESCE(u.bloqueado_hasta > now(), false) AS bloqueado,
                   to_char(u.bloqueado_hasta AT TIME ZONE 'America/Lima', 'HH24:MI') AS hasta,
                   d.id AS dispositivo_id
              FROM dispositivo d JOIN usuario u ON u.id = d.usuario_id
             WHERE d.device_uuid = %s AND d.activo AND u.activo AND u.rol IN ('acopiador', 'analista')
               FOR UPDATE OF u
        """, (datos.device_uuid,))
        if fila is None:
            raise ErrorApi(401, "dispositivo_no_vinculado", "Este celular no está vinculado o fue desactivado")
        db.fijar_usuario(conn, fila["id"])
        if fila["bloqueado"]:
            error = ErrorApi(423, "bloqueado", f"PIN bloqueado hasta las {fila['hasta']}")
        elif not seguridad.verificar(datos.pin, fila["pin_hash"]):
            error = _error_fallo_pin(_registrar_fallo_pin(conn, fila["id"]))
        else:
            conn.execute("UPDATE usuario SET pin_intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = %s",
                         (fila["id"],))
            conn.execute("UPDATE dispositivo SET ultimo_acceso = now() WHERE id = %s", (fila["dispositivo_id"],))
    if error is not None:
        raise error

    minutos = config().jwt_minutos_movil
    return TokenMovil(
        access_token=seguridad.crear_token(fila["id"], fila["rol"], minutos, fila["dispositivo_id"]),
        expira_en_min=minutos,
        dispositivo_id=fila["dispositivo_id"],
        debe_cambiar_pin=fila["debe_cambiar_pin"],
        usuario=UsuarioSesion(id=fila["id"], rol=fila["rol"], nombre_completo=fila["nombre_completo"]),
    )


@router.post("/pin/cambiar", status_code=204)
def cambiar_pin(datos: CambiarPin, usuario: Usuario = Depends(solo_movil)):
    error: ErrorApi | None = None
    with db.transaccion(usuario.id) as conn:
        fila = db.uno(conn, "SELECT pin_hash FROM usuario WHERE id = %s FOR UPDATE", (usuario.id,))
        if not seguridad.verificar(datos.pin_actual, fila["pin_hash"]):
            error = _error_fallo_pin(_registrar_fallo_pin(conn, usuario.id))
        else:
            conn.execute("""
                UPDATE usuario SET pin_hash = %s, pin_actualizado_en = now(),
                       pin_intentos_fallidos = 0, bloqueado_hasta = NULL
                 WHERE id = %s
            """, (seguridad.hashear(datos.pin_nuevo), usuario.id))
    if error is not None:
        raise error
