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
# Límite de contraseñas de admin fallidas por IP (usuario no tiene contador de intentos para el admin)
LOGIN_ADMIN_MAX_FALLOS = 10
LOGIN_ADMIN_VENTANA_S = 600
_fallos_login_admin: dict[str, deque] = defaultdict(deque)
_candado = threading.Lock()


def _ip(request: Request) -> str:
    return request.client.host if request.client else "?"


def _fallos_recientes(registro: dict[str, deque], ip: str, ventana_s: int) -> deque:
    cola = registro[ip]
    limite = time.monotonic() - ventana_s
    while cola and cola[0] < limite:
        cola.popleft()
    return cola


def reiniciar_limites() -> None:
    with _candado:
        _fallos_activar.clear()
        _fallos_login_admin.clear()


@router.post("/admin/login", response_model=Token)
def login_admin(datos: LoginAdmin, request: Request):
    ip = _ip(request)
    # Con el límite alcanzado se corta antes de revisar la contraseña (ni la correcta pasa)
    with _candado:
        if len(_fallos_recientes(_fallos_login_admin, ip, LOGIN_ADMIN_VENTANA_S)) >= LOGIN_ADMIN_MAX_FALLOS:
            raise ErrorApi(429, "demasiados_intentos", "Demasiados intentos fallidos. Intente en unos minutos")

    with db.pool().connection() as conn:
        fila = db.uno(conn, """
            SELECT id, nombre_completo, password_hash FROM usuario
             WHERE lower(email) = lower(%s) AND rol = 'admin' AND activo
        """, (datos.email,))
    # Con correo inexistente se compara igual contra un hash de relleno (mismo tiempo de respuesta)
    if not seguridad.verificar(datos.password, fila["password_hash"] if fila else None) or fila is None:
        with _candado:
            _fallos_recientes(_fallos_login_admin, ip, LOGIN_ADMIN_VENTANA_S).append(time.monotonic())
        raise no_autorizado("Correo o contraseña incorrectos")
    minutos = config().jwt_minutos_admin
    return Token(
        access_token=seguridad.crear_token(fila["id"], "admin", minutos),
        expira_en_min=minutos,
        usuario=UsuarioSesion(id=fila["id"], rol="admin", nombre_completo=fila["nombre_completo"]),
    )


@router.post("/dispositivo/activar", response_model=DispositivoActivado)
def activar_dispositivo(datos: Activar, request: Request):
    ip = _ip(request)
    with _candado:
        if len(_fallos_recientes(_fallos_activar, ip, ACTIVAR_VENTANA_S)) >= ACTIVAR_MAX_FALLOS:
            raise ErrorApi(429, "demasiados_intentos", "Demasiados códigos incorrectos. Intente en unos minutos")

    with db.transaccion(None) as conn:
        codigo = db.uno(conn, """
            SELECT c.id, u.id AS usuario_id, u.rol::text AS rol, u.nombre_completo, u.activo, u.dni, u.celular
              FROM codigo_activacion c JOIN usuario u ON u.id = c.usuario_id
             WHERE c.codigo_hash = %s AND c.usado_en IS NULL AND c.expira_en > now()
               FOR UPDATE OF c
        """, (seguridad.hash_codigo(datos.codigo),))
        if codigo is not None and codigo["activo"] and codigo["rol"] in ("acopiador", "analista"):
            uid = codigo["usuario_id"]
            # PIN trivial: 422 y la transacción se deshace, así que el código sigue sin usar
            validar_pin_nuevo(datos.pin, codigo["dni"], codigo["celular"])
            db.fijar_usuario(conn, uid)
            conn.execute("UPDATE codigo_activacion SET usado_en = now() WHERE id = %s", (codigo["id"],))
            # El PIN lo crea el propio usuario: reemplaza el anterior y quita fallos y bloqueo
            # (así se recupera un PIN olvidado: el admin genera un código nuevo y se reactiva)
            conn.execute("""
                UPDATE usuario SET pin_hash = %s, pin_actualizado_en = now(),
                       pin_intentos_fallidos = 0, bloqueado_hasta = NULL
                 WHERE id = %s
            """, (seguridad.hashear(datos.pin), uid))

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
            minutos = config().jwt_minutos_movil
            return DispositivoActivado(
                access_token=seguridad.crear_token(uid, codigo["rol"], minutos, disp["id"]),
                expira_en_min=minutos,
                dispositivo_id=disp["id"], activado_en=disp["activado_en"],
                usuario=UsuarioSesion(id=uid, rol=codigo["rol"], nombre_completo=codigo["nombre_completo"]),
            )

    with _candado:
        _fallos_recientes(_fallos_activar, ip, ACTIVAR_VENTANA_S).append(time.monotonic())
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
                   (u.pin_hash IS NULL OR u.pin_actualizado_en IS NULL) AS sin_pin_propio,
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
        if fila["sin_pin_propio"]:
            # PIN puesto por el admin (sistema anterior al Bloque 6) o aún sin PIN: el usuario debe
            # crear el suyo activando con un código nuevo. No es un intento fallido.
            error = ErrorApi(401, "debe_reactivar", "Pida un código nuevo al administrador para crear su PIN")
        elif fila["bloqueado"]:
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
        usuario=UsuarioSesion(id=fila["id"], rol=fila["rol"], nombre_completo=fila["nombre_completo"]),
    )


def validar_pin_nuevo(pin: str, dni: str | None, celular: str | None) -> None:
    """422 si el PIN que se va a crear es trivial. No cuenta como intento fallido."""
    motivo = seguridad.pin_trivial(pin, dni, celular)
    if motivo is not None:
        raise ErrorApi(422, "pin_trivial", f"Elija un PIN menos obvio: {motivo}")


@router.post("/pin/cambiar", status_code=204)
def cambiar_pin(datos: CambiarPin, usuario: Usuario = Depends(solo_movil)):
    # El PIN nuevo se revisa ANTES de verificar el actual: un PIN nuevo inválido no gasta un intento
    if datos.pin_nuevo == datos.pin_actual:
        raise ErrorApi(422, "pin_repetido", "El PIN nuevo debe ser distinto del actual")
    error: ErrorApi | None = None
    with db.transaccion(usuario.id) as conn:
        fila = db.uno(conn, "SELECT pin_hash, dni, celular FROM usuario WHERE id = %s FOR UPDATE", (usuario.id,))
        validar_pin_nuevo(datos.pin_nuevo, fila["dni"], fila["celular"])
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
