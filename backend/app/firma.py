"""Firma de las recolecciones: cadena canónica v1 y verificación ECDSA P-256 + SHA-256.

La especificación exacta (para implementarla igual en Android) está en docs/sincronizacion.md.
La base no verifica firmas: si la verificación falla, la API guarda la recolección igual y crea la
alerta firma_invalida (que retiene el pago).
"""
import base64
import binascii
import hashlib
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import load_der_public_key

from .esquemas.sync import RecoleccionPush

VERSION = "v1"


def _decimal(valor: Decimal | None, decimales: int) -> str:
    if valor is None:
        return ""
    return str(valor.quantize(Decimal(1).scaleb(-decimales), rounding=ROUND_HALF_UP))


def _hora(valor: datetime | None) -> str:
    """UTC con milisegundos (truncados): 2026-10-10T13:05:09.120Z"""
    if valor is None:
        return ""
    utc = valor.astimezone(timezone.utc)
    return utc.strftime("%Y-%m-%dT%H:%M:%S.") + f"{utc.microsecond // 1000:03d}Z"


def _bool(valor: bool | None) -> str:
    return "" if valor is None else ("true" if valor else "false")


def cadena_canonica(r: RecoleccionPush) -> str:
    """Se arma con los datos tal como los envió el celular (antes de normalizar la ubicación)."""
    productor = f"id:{r.productor_id}" if r.productor_id is not None else f"uuid:{r.productor_uuid_cliente}"
    observacion = hashlib.sha256(r.observacion.encode("utf-8")).hexdigest() if r.observacion else ""
    return "|".join([
        VERSION,
        str(r.id),
        productor,
        _decimal(r.litros, 2),
        _hora(r.registrada_en),
        _decimal(r.latitud, 6),
        _decimal(r.longitud, 6),
        _decimal(r.precision_m, 1),
        r.origen_ubicacion or "",
        _bool(r.ubicacion_simulada),
        _hora(r.hora_gps),
        _bool(r.hora_automatica),
        observacion,
        r.hash_anterior or "",
    ])


def _b64(texto: str) -> bytes:
    return base64.b64decode(texto.strip(), validate=True)


def verificar(r: RecoleccionPush, clave_publica: str | None) -> str | None:
    """None si la firma es válida; si no, el motivo (va al detalle de la alerta firma_invalida)."""
    if not r.firma:
        return "La recolección llegó sin firma"
    if not clave_publica:
        return "El celular no tiene clave pública registrada"
    try:
        clave = load_der_public_key(_b64(clave_publica))
    except (ValueError, binascii.Error, TypeError):
        return "La clave pública del celular no se puede leer"
    if not isinstance(clave, ec.EllipticCurvePublicKey) or not isinstance(clave.curve, ec.SECP256R1):
        return "La clave pública del celular no es ECDSA P-256"
    try:
        firma = _b64(r.firma)
    except (ValueError, binascii.Error):
        return "La firma no está en base64"
    try:
        cadena = cadena_canonica(r)
    except InvalidOperation:
        return "Hay números fuera de rango: no se pudo armar la cadena firmada"
    try:
        clave.verify(firma, cadena.encode("utf-8"), ec.ECDSA(hashes.SHA256()))
    except InvalidSignature:
        return "La firma no coincide con los datos de la recolección"
    return None


def hash_de_firma(firma: str) -> str:
    """Valor de hash_anterior para el registro siguiente del mismo celular."""
    return hashlib.sha256(firma.encode("ascii")).hexdigest()
