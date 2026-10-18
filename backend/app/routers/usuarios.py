"""Usuarios de la app móvil: acopiadores, analistas, códigos de activación, PIN y celulares."""
from fastapi import APIRouter, Depends

from .. import db, seguridad
from ..config import config
from ..deps import Usuario, solo_admin
from ..errores import no_encontrado, validacion
from ..esquemas.usuarios import (Acopiador, AcopiadorCambios, AcopiadorNuevo, CodigoActivacion, Dispositivo,
                                 UsuarioMovil, UsuarioMovilCambios, UsuarioMovilNuevo)

router_acopiadores = APIRouter(prefix="/acopiadores", tags=["acopiadores"])
router_analistas = APIRouter(prefix="/analistas", tags=["analistas"])
router_usuarios = APIRouter(tags=["usuarios móviles"])

CAMPOS_USUARIO = {"nombre_completo", "dni", "celular", "activo"}

SELECT_USUARIO = """
    SELECT u.id, u.rol::text AS rol, u.nombre_completo, u.dni, u.celular, u.activo,
           COALESCE(u.bloqueado_hasta > now(), false) AS pin_bloqueado,
           (u.pin_hash IS NULL OR u.pin_actualizado_en IS NULL) AS pin_pendiente,
           EXISTS (SELECT 1 FROM dispositivo d WHERE d.usuario_id = u.id AND d.activo) AS celular_vinculado
      FROM usuario u
"""

SELECT_ACOPIADOR = """
    SELECT u.id, u.rol::text AS rol, u.nombre_completo, u.dni, u.celular, u.activo,
           COALESCE(u.bloqueado_hasta > now(), false) AS pin_bloqueado,
           (u.pin_hash IS NULL OR u.pin_actualizado_en IS NULL) AS pin_pendiente,
           EXISTS (SELECT 1 FROM dispositivo d WHERE d.usuario_id = u.id AND d.activo) AS celular_vinculado,
           a.color_hex, a.vehiculo::text AS vehiculo, a.sueldo_base_mensual, a.comision_por_litro,
           COALESCE((SELECT json_agg(json_build_object('ruta_id', r.id, 'nombre', r.nombre,
                                                       'vigente_desde', ra.vigente_desde) ORDER BY r.nombre)
                       FROM ruta_acopiador ra JOIN ruta r ON r.id = ra.ruta_id
                      WHERE ra.acopiador_id = u.id AND ra.vigente_hasta IS NULL), '[]'::json) AS rutas
      FROM usuario u JOIN acopiador a ON a.usuario_id = u.id
"""


def _insertar_usuario(conn, rol: str, datos: UsuarioMovilNuevo) -> int:
    # Sin PIN (pin_hash NULL = pendiente de activar): el usuario crea el suyo al activar su celular
    return db.uno(conn, """
        INSERT INTO usuario (rol, nombre_completo, dni, celular)
        VALUES (%s, %s, %s, %s) RETURNING id
    """, (rol, datos.nombre_completo, datos.dni, datos.celular))["id"]


def _usuario_movil(conn, usuario_id: int, rol: str) -> dict:
    fila = db.uno(conn, SELECT_USUARIO + " WHERE u.id = %s AND u.rol = %s", (usuario_id, rol))
    if fila is None:
        raise no_encontrado(f"El {rol} no existe")
    return fila


def _acopiador(conn, usuario_id: int) -> dict:
    fila = db.uno(conn, SELECT_ACOPIADOR + " WHERE u.id = %s", (usuario_id,))
    if fila is None:
        raise no_encontrado("El acopiador no existe")
    return fila


# ----------------------------------------------------------------- acopiadores
@router_acopiadores.get("", response_model=list[Acopiador])
def listar_acopiadores(usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        return db.todos(conn, SELECT_ACOPIADOR + " ORDER BY u.nombre_completo")


@router_acopiadores.post("", response_model=Acopiador, status_code=201)
def crear_acopiador(datos: AcopiadorNuevo, usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        uid = _insertar_usuario(conn, "acopiador", datos)
        conn.execute("""
            INSERT INTO acopiador (usuario_id, color_hex, vehiculo, sueldo_base_mensual, comision_por_litro)
            VALUES (%s, %s, %s, %s, %s)
        """, (uid, datos.color_hex, datos.vehiculo, datos.sueldo_base_mensual, datos.comision_por_litro))
        return _acopiador(conn, uid)


@router_acopiadores.get("/{acopiador_id}", response_model=Acopiador)
def obtener_acopiador(acopiador_id: int, usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        return _acopiador(conn, acopiador_id)


@router_acopiadores.patch("/{acopiador_id}", response_model=Acopiador)
def editar_acopiador(acopiador_id: int, datos: AcopiadorCambios, usuario: Usuario = Depends(solo_admin)):
    cambios = datos.model_dump(exclude_unset=True)
    with db.transaccion(usuario.id) as conn:
        _acopiador(conn, acopiador_id)
        db.actualizar(conn, "usuario", "id", acopiador_id, {k: v for k, v in cambios.items() if k in CAMPOS_USUARIO})
        db.actualizar(conn, "acopiador", "usuario_id", acopiador_id,
                      {k: v for k, v in cambios.items() if k not in CAMPOS_USUARIO})
        return _acopiador(conn, acopiador_id)


# ----------------------------------------------------------------- analistas
@router_analistas.get("", response_model=list[UsuarioMovil])
def listar_analistas(usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        return db.todos(conn, SELECT_USUARIO + " WHERE u.rol = 'analista' ORDER BY u.nombre_completo")


@router_analistas.post("", response_model=UsuarioMovil, status_code=201)
def crear_analista(datos: UsuarioMovilNuevo, usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        return _usuario_movil(conn, _insertar_usuario(conn, "analista", datos), "analista")


@router_analistas.get("/{analista_id}", response_model=UsuarioMovil)
def obtener_analista(analista_id: int, usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        return _usuario_movil(conn, analista_id, "analista")


@router_analistas.patch("/{analista_id}", response_model=UsuarioMovil)
def editar_analista(analista_id: int, datos: UsuarioMovilCambios, usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        _usuario_movil(conn, analista_id, "analista")
        db.actualizar(conn, "usuario", "id", analista_id, datos.model_dump(exclude_unset=True))
        return _usuario_movil(conn, analista_id, "analista")


# ----------------------------------------------------------------- acceso móvil
def _exigir_usuario_movil(conn, usuario_id: int) -> None:
    fila = db.uno(conn, "SELECT rol::text AS rol FROM usuario WHERE id = %s", (usuario_id,))
    if fila is None:
        raise no_encontrado("El usuario no existe")
    if fila["rol"] not in ("acopiador", "analista"):
        raise validacion("Solo acopiadores y analistas usan la app móvil")


@router_usuarios.post("/usuarios/{usuario_id}/codigo-activacion", response_model=CodigoActivacion, status_code=201)
def generar_codigo(usuario_id: int, usuario: Usuario = Depends(solo_admin)):
    """Genera el código para vincular el celular (un solo uso, CODIGO_ACTIVACION_MINUTOS de vida).

    Se muestra una sola vez; en la base solo queda su hash. También es la forma de recuperar un PIN
    olvidado: el usuario vuelve a activar con el código nuevo y crea otro PIN.
    """
    codigo = seguridad.generar_codigo()
    with db.transaccion(usuario.id) as conn:
        _exigir_usuario_movil(conn, usuario_id)
        # Los códigos anteriores que nunca se usaron dejan de servir
        conn.execute("DELETE FROM codigo_activacion WHERE usuario_id = %s AND usado_en IS NULL", (usuario_id,))
        fila = db.uno(conn, """
            INSERT INTO codigo_activacion (usuario_id, codigo_hash, creado_por, expira_en)
            VALUES (%s, %s, %s, now() + make_interval(mins => %s)) RETURNING expira_en
        """, (usuario_id, seguridad.hash_codigo(codigo), usuario.id, config().codigo_activacion_minutos))
    return CodigoActivacion(codigo=codigo, expira_en=fila["expira_en"])


@router_usuarios.get("/usuarios/{usuario_id}/dispositivos", response_model=list[Dispositivo])
def listar_dispositivos(usuario_id: int, usuario: Usuario = Depends(solo_admin)):
    with db.transaccion(usuario.id) as conn:
        _exigir_usuario_movil(conn, usuario_id)
        return db.todos(conn, """
            SELECT id, usuario_id, device_uuid, modelo, activado_en, ultimo_acceso, activo
              FROM dispositivo WHERE usuario_id = %s ORDER BY activo DESC, activado_en DESC
        """, (usuario_id,))


@router_usuarios.post("/dispositivos/{dispositivo_id}/desactivar", response_model=Dispositivo)
def desactivar_dispositivo(dispositivo_id: int, usuario: Usuario = Depends(solo_admin)):
    """Celular perdido o cambiado: deja de poder entrar al instante."""
    with db.transaccion(usuario.id) as conn:
        fila = db.uno(conn, """
            UPDATE dispositivo SET activo = false WHERE id = %s
         RETURNING id, usuario_id, device_uuid, modelo, activado_en, ultimo_acceso, activo
        """, (dispositivo_id,))
        if fila is None:
            raise no_encontrado("El celular no existe")
        return fila
