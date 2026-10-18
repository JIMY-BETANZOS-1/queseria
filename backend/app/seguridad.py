"""Contraseñas y PIN (bcrypt), JWT y códigos de activación."""
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from .config import config

ALGORITMO = "HS256"
# Sin 0/O, 1/I/L: el código se dicta por teléfono o se copia a mano
ALFABETO_CODIGO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
LARGO_CODIGO = 8

# Hash de relleno para comparar en tiempo constante cuando el correo no existe
HASH_FICTICIO = bcrypt.hashpw(b"no-existe", bcrypt.gensalt()).decode()


def hashear(secreto: str) -> str:
    return bcrypt.hashpw(secreto.encode(), bcrypt.gensalt()).decode()


def verificar(secreto: str, hash_: str | None) -> bool:
    try:
        return bcrypt.checkpw(secreto.encode(), (hash_ or HASH_FICTICIO).encode()) and hash_ is not None
    except ValueError:
        return False


def pin_trivial(pin: str, dni: str | None = None, celular: str | None = None) -> str | None:
    """Por qué un PIN de 4 dígitos es demasiado fácil de adivinar, o None si se acepta.

    Rechaza 204 de las 10 000 combinaciones: todos iguales (0000), secuencias de subida o de bajada
    (1234, 4321), pares repetidos (1212) y dobles (1122); además, los últimos 4 dígitos del DNI o del
    celular del propio usuario. Se aplica al CREAR el PIN, nunca al ingresar: un PIN viejo no deja
    fuera a nadie. Las mismas reglas están en el móvil (ReglasPin.kt) solo para avisar antes de enviar.
    """
    a, b, c, d = pin
    if a == b == c == d:
        return "todos los dígitos son iguales"
    pasos = {int(y) - int(x) for x, y in zip(pin, pin[1:])}
    if pasos == {1} or pasos == {-1}:
        return "es una secuencia"
    if a == c and b == d:
        return "repite un par de dígitos"
    if a == b and c == d:
        return "repite dígitos de a dos"
    if dni and dni[-4:] == pin:
        return "son los últimos dígitos de su DNI"
    if celular and celular[-4:] == pin:
        return "son los últimos dígitos de su celular"
    return None


def crear_token(usuario_id: int, rol: str, minutos: int, dispositivo_id: int | None = None) -> str:
    ahora = datetime.now(timezone.utc)
    datos = {"sub": str(usuario_id), "rol": rol, "iat": ahora, "exp": ahora + timedelta(minutes=minutos)}
    if dispositivo_id is not None:
        datos["dis"] = dispositivo_id
    return jwt.encode(datos, config().jwt_secret, algorithm=ALGORITMO)


def leer_token(token: str) -> dict:
    """Lanza jwt.InvalidTokenError si el token es inválido o venció."""
    return jwt.decode(token, config().jwt_secret, algorithms=[ALGORITMO], options={"require": ["sub", "exp"]})


def generar_codigo() -> str:
    return "".join(secrets.choice(ALFABETO_CODIGO) for _ in range(LARGO_CODIGO))


def normalizar_codigo(codigo: str) -> str:
    return "".join(c for c in codigo.upper() if c.isalnum())


def hash_codigo(codigo: str) -> str:
    """HMAC (determinista) para poder buscar el código por su hash; nunca se guarda el código."""
    return hmac.new(config().jwt_secret.encode(), normalizar_codigo(codigo).encode(), hashlib.sha256).hexdigest()
