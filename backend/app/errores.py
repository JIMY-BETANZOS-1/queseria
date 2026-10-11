"""Traducción de errores a respuestas JSON en español.

Las reglas de negocio viven en la base: aquí solo se traduce lo que la base rechaza.
  P0001 (RAISE EXCEPTION de un trigger) -> 409 con el mensaje de la base
  23505 unique                          -> 409
  23514 check, 23503 FK, 23502 not null, 22xxx dato inválido -> 422
Formato único: {"codigo": "...", "mensaje": "..."}
"""
import logging

import psycopg
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("queseria")


class ErrorApi(Exception):
    def __init__(self, status: int, codigo: str, mensaje: str):
        self.status, self.codigo, self.mensaje = status, codigo, mensaje


def no_encontrado(mensaje: str) -> ErrorApi:
    return ErrorApi(404, "no_encontrado", mensaje)


def conflicto(mensaje: str) -> ErrorApi:
    return ErrorApi(409, "conflicto", mensaje)


def validacion(mensaje: str) -> ErrorApi:
    return ErrorApi(422, "validacion", mensaje)


# Mensajes por nombre de constraint / índice único del esquema
UNICOS = {
    "ruta_nombre_key": "Ya existe una ruta con ese nombre",
    "usuario_dni_key": "Ya existe un usuario con ese DNI",
    "usuario_email_key": "Ya existe un usuario con ese correo",
    "acopiador_color_hex_key": "Ese color ya lo usa otro acopiador",
    "productor_codigo_key": "Ya existe un productor con ese código",
    "uq_productor_documento": "Ya existe un productor con ese documento",
    "productor_uuid_cliente_key": "El productor ya fue registrado",
    "uq_ruta_un_acopiador_vigente": "La ruta ya tiene un acopiador vigente",
    "uq_precio_leche": "Ya existe un precio de ese tipo con esa fecha de vigencia",
    "dispositivo_device_uuid_key": "Este celular ya está vinculado a otro usuario",
    "uq_dispositivo_activo_por_usuario": "El usuario ya tiene un celular activo",
}

CHECKS = {
    "ck_usuario_dni": "El DNI debe tener 8 dígitos",
    "ck_usuario_celular": "El celular debe tener 9 dígitos",
    "ck_usuario_credenciales": "Faltan datos de acceso: el admin necesita correo y contraseña; "
                               "acopiadores y analistas, DNI, celular y PIN",
    "ck_acopiador_color": "El color debe tener el formato #RRGGBB",
    "acopiador_sueldo_base_mensual_check": "El sueldo base no puede ser negativo",
    "acopiador_comision_por_litro_check": "La comisión por litro no puede ser negativa",
    "ck_productor_documento": "El documento debe ser un DNI (8 dígitos) o RUC (11 dígitos)",
    "ck_productor_celular": "El celular debe tener 9 dígitos",
    "ck_productor_ref": "La ubicación de referencia necesita latitud y longitud",
    "ck_productor_tipo": "Un productor de ruta necesita ruta; un externo no lleva ruta y necesita documento y celular",
    "ck_ruta_acopiador_fechas": "La fecha de cambio no puede ser anterior al inicio de la asignación vigente",
    "precio_leche_precio_litro_check": "El precio por litro debe ser mayor que cero",
}

FORANEAS = {
    "ruta_acopiador_acopiador_id_fkey": "El acopiador no existe",
    "ruta_acopiador_ruta_id_fkey": "La ruta no existe",
    "productor_ruta_id_fkey": "La ruta no existe",
}


def traducir(e: psycopg.Error) -> ErrorApi:
    estado = e.sqlstate or ""
    diag = e.diag
    nombre = diag.constraint_name or ""
    if estado == "P0001":
        return conflicto(diag.message_primary or str(e))
    if estado == "23505":
        return conflicto(UNICOS.get(nombre, "El registro ya existe"))
    if estado == "23514":
        return validacion(CHECKS.get(nombre, "Algún dato no cumple las reglas de la base"))
    if estado == "23503":
        return validacion(FORANEAS.get(nombre, "Se hace referencia a un registro que no existe "
                                               "o el registro está en uso"))
    if estado == "23502":
        return validacion(f"Falta un dato obligatorio: {diag.column_name or 'desconocido'}")
    if estado.startswith("22"):
        return validacion("Algún dato tiene un valor o formato inválido")
    log.exception("Error de base no traducido", exc_info=e)
    return ErrorApi(500, "error_interno", "Error interno en la base de datos")


MENSAJES_VALIDACION = {
    "missing": "Campo obligatorio",
    "string_type": "Debe ser texto",
    "string_too_short": "Texto demasiado corto",
    "string_too_long": "Texto demasiado largo",
    "string_pattern_mismatch": "Formato inválido",
    "int_parsing": "Debe ser un número entero",
    "int_type": "Debe ser un número entero",
    "float_parsing": "Debe ser un número",
    "decimal_parsing": "Debe ser un número",
    "bool_parsing": "Debe ser verdadero o falso",
    "date_parsing": "Fecha inválida (AAAA-MM-DD)",
    "date_from_datetime_parsing": "Fecha inválida (AAAA-MM-DD)",
    "uuid_parsing": "UUID inválido",
    "greater_than": "Valor demasiado pequeño",
    "greater_than_equal": "Valor demasiado pequeño",
    "less_than_equal": "Valor demasiado grande",
    "enum": "Valor no permitido",
    "literal_error": "Valor no permitido",
    "extra_forbidden": "Campo no permitido",
    "json_invalid": "JSON inválido",
}

ESTADOS_HTTP = {401: "no_autorizado", 403: "prohibido", 404: "no_encontrado", 405: "metodo_no_permitido"}


def _json(status: int, codigo: str, mensaje: str, **extra) -> JSONResponse:
    return JSONResponse(status_code=status, content={"codigo": codigo, "mensaje": mensaje, **extra})


def registrar_manejadores(app: FastAPI) -> None:
    @app.exception_handler(ErrorApi)
    async def _error_api(_: Request, e: ErrorApi):
        return _json(e.status, e.codigo, e.mensaje)

    @app.exception_handler(psycopg.Error)
    async def _error_base(_: Request, e: psycopg.Error):
        t = traducir(e)
        return _json(t.status, t.codigo, t.mensaje)

    @app.exception_handler(RequestValidationError)
    async def _error_validacion(_: Request, e: RequestValidationError):
        errores = [
            {"campo": ".".join(str(p) for p in err["loc"] if p != "body"),
             "mensaje": MENSAJES_VALIDACION.get(err["type"], err.get("msg", "Valor inválido"))}
            for err in e.errors()
        ]
        return _json(422, "validacion", "Datos inválidos", errores=errores)

    @app.exception_handler(StarletteHTTPException)
    async def _error_http(_: Request, e: StarletteHTTPException):
        mensaje = TRADUCCION_HTTP.get(str(e.detail), str(e.detail))
        return _json(e.status_code, ESTADOS_HTTP.get(e.status_code, "error"), mensaje)


TRADUCCION_HTTP = {
    "Not Found": "No encontrado",
    "Method Not Allowed": "Método no permitido",
    "Not authenticated": "Debe iniciar sesión",
}
