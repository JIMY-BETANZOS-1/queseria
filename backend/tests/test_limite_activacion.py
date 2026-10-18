"""Límite de códigos de activación inválidos por IP (routers/auth.py: ACTIVAR_MAX_FALLOS en ACTIVAR_VENTANA_S)."""
import uuid

from app.routers.auth import ACTIVAR_MAX_FALLOS, reiniciar_limites
from conftest import activar, crear_acopiador, generar_codigo

# Mismo alfabeto que los códigos reales, pero nunca generado (la base solo tiene HMAC de códigos emitidos)
INVALIDO = "ZZZZZZZZ"


def test_el_codigo_invalido_numero_11_da_429(client, admin):
    assert ACTIVAR_MAX_FALLOS == 10
    for _ in range(ACTIVAR_MAX_FALLOS):
        r = activar(client, INVALIDO)
        assert r.status_code == 401
        assert r.json()["mensaje"] == "Código inválido, vencido o ya usado"
    r = activar(client, INVALIDO)
    assert r.status_code == 429
    assert r.json()["codigo"] == "demasiados_intentos"

    # Con el límite alcanzado, ni un código válido pasa: se corta antes de buscarlo
    acop = crear_acopiador(client, admin)
    assert activar(client, generar_codigo(client, admin, acop["id"])).status_code == 429


def test_un_codigo_valido_con_pin_trivial_no_cuenta_como_fallo(client, admin):
    acop = crear_acopiador(client, admin)
    codigo = generar_codigo(client, admin, acop["id"])
    device = str(uuid.uuid4())

    for _ in range(ACTIVAR_MAX_FALLOS - 1):                 # 9 fallos: queda uno antes del límite
        assert activar(client, INVALIDO).status_code == 401
    for trivial in ("0000", "1234", "1212"):                # código válido + PIN trivial: 422, no suma
        assert activar(client, codigo, device, pin=trivial).status_code == 422
    assert activar(client, INVALIDO).status_code == 401     # 10.º fallo
    assert activar(client, INVALIDO).status_code == 429     # recién aquí se bloquea


def test_reiniciar_limites_lo_restablece(client, admin):
    for _ in range(ACTIVAR_MAX_FALLOS):
        activar(client, INVALIDO)
    assert activar(client, INVALIDO).status_code == 429

    reiniciar_limites()
    acop = crear_acopiador(client, admin)
    assert activar(client, generar_codigo(client, admin, acop["id"])).status_code == 200
    assert activar(client, INVALIDO).status_code == 401     # el contador volvió a cero
