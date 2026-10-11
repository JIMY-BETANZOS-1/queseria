"""Pruebas contra la base queseria_test cargada con schema.sql + seed.sql (ver scripts/test.ps1)."""
import os
import random
import uuid

# Antes de importar la app: base de pruebas y secreto propio
os.environ["PGDATABASE"] = "queseria_test"
os.environ["JWT_SECRET"] = "secreto-solo-para-pruebas-0123456789"

import psycopg  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from psycopg.rows import dict_row  # noqa: E402

from app.config import config  # noqa: E402
from app.main import app  # noqa: E402
from app.routers.auth import reiniciar_limites  # noqa: E402

ADMIN_EMAIL = "admin@queseria.test"
ADMIN_PASSWORD = "Admin2026!"


@pytest.fixture(scope="session")
def db():
    """Conexión directa (autocommit) para preparar datos y verificar lo que quedó en la base."""
    with psycopg.connect(config().conninfo, autocommit=True, row_factory=dict_row) as conn:
        if conn.execute("SELECT 1 FROM usuario WHERE email = %s", (ADMIN_EMAIL,)).fetchone() is None:
            pytest.exit("La base queseria_test no tiene el seed. Ejecuta backend/scripts/test.ps1", returncode=2)
        yield conn


@pytest.fixture(scope="session")
def client(db):
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _limites():
    reiniciar_limites()


@pytest.fixture(scope="session")
def admin(client) -> dict:
    r = client.post("/auth/admin/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}", "id": str(r.json()["usuario"]["id"])}


def cab(token_o_cab) -> dict:
    """Cabeceras HTTP a partir de un token o del dict de admin."""
    if isinstance(token_o_cab, dict):
        return {"Authorization": token_o_cab["Authorization"]}
    return {"Authorization": f"Bearer {token_o_cab}"}


def dni() -> str:
    return str(random.randint(10_000_000, 99_999_999))


def celular() -> str:
    return "9" + str(random.randint(10_000_000, 99_999_999))


def color() -> str:
    return "#%06X" % random.randint(0, 0xFFFFFF)


def crear_acopiador(client, admin, pin="4321", **extra) -> dict:
    datos = {"nombre_completo": f"Acopiador Prueba {uuid.uuid4().hex[:6]}", "dni": dni(), "celular": celular(),
             "pin_inicial": pin, "color_hex": color(), "vehiculo": "motocarga",
             "sueldo_base_mensual": 850, "comision_por_litro": 0.05, **extra}
    r = client.post("/acopiadores", json=datos, headers=cab(admin))
    assert r.status_code == 201, r.text
    return r.json()


def generar_codigo(client, admin, usuario_id: int) -> str:
    r = client.post(f"/usuarios/{usuario_id}/codigo-activacion", headers=cab(admin))
    assert r.status_code == 201, r.text
    return r.json()["codigo"]


def activar(client, codigo: str, device_uuid: str | None = None):
    return client.post("/auth/dispositivo/activar", json={
        "codigo": codigo, "device_uuid": device_uuid or str(uuid.uuid4()),
        "clave_publica": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE-prueba", "modelo": "Prueba"})


def login_pin(client, device_uuid: str, pin: str):
    return client.post("/auth/pin/login", json={"device_uuid": device_uuid, "pin": pin})


def acopiador_con_celular(client, admin, pin="4321") -> dict:
    """Acopiador nuevo con celular vinculado y sesión iniciada."""
    acop = crear_acopiador(client, admin, pin=pin)
    device = str(uuid.uuid4())
    assert activar(client, generar_codigo(client, admin, acop["id"]), device).status_code == 200
    r = login_pin(client, device, pin)
    assert r.status_code == 200, r.text
    return {**acop, "device_uuid": device, "token": r.json()["access_token"], "pin": pin}
