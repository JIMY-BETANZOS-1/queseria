"""Pruebas contra la base queseria_test cargada con schema.sql + seed.sql (ver scripts/test.ps1)."""
import base64
import os
import random
import tempfile
import uuid

# Antes de importar la app: base de pruebas, secreto propio y carpeta temporal para las fotos
os.environ["PGDATABASE"] = "queseria_test"
os.environ["JWT_SECRET"] = "secreto-solo-para-pruebas-0123456789"
os.environ["STORAGE_DIR"] = tempfile.mkdtemp(prefix="queseria-storage-")

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


# PIN de los usuarios de prueba: 4 dígitos y no trivial (seguridad.pin_trivial)
PIN = "4821"


def _sin_pin_al_final(generar) -> str:
    # Un DNI o celular que termine en PIN lo volvería trivial y la activación daría 422
    while (valor := generar()).endswith(PIN):
        pass
    return valor


def dni() -> str:
    return _sin_pin_al_final(lambda: str(random.randint(10_000_000, 99_999_999)))


def celular() -> str:
    return _sin_pin_al_final(lambda: "9" + str(random.randint(10_000_000, 99_999_999)))


def ruc() -> str:
    """RUC de empresa (20 + 9 dígitos): cumple ck_productor_documento y no choca entre corridas."""
    return "20" + str(random.randint(100_000_000, 999_999_999))


def color() -> str:
    return "#%06X" % random.randint(0, 0xFFFFFF)


def crear_acopiador(client, admin, **extra) -> dict:
    """Acopiador nuevo, sin PIN: lo crea él mismo al activar su celular."""
    datos = {"nombre_completo": f"Acopiador Prueba {uuid.uuid4().hex[:6]}", "dni": dni(), "celular": celular(),
             "color_hex": color(), "vehiculo": "motocarga",
             "sueldo_base_mensual": 850, "comision_por_litro": 0.05, **extra}
    r = client.post("/acopiadores", json=datos, headers=cab(admin))
    assert r.status_code == 201, r.text
    return r.json()


def generar_codigo(client, admin, usuario_id: int) -> str:
    r = client.post(f"/usuarios/{usuario_id}/codigo-activacion", headers=cab(admin))
    assert r.status_code == 201, r.text
    return r.json()["codigo"]


def activar(client, codigo: str, device_uuid: str | None = None,
            clave_publica: str = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE-prueba", pin: str = PIN):
    return client.post("/auth/dispositivo/activar", json={
        "codigo": codigo, "device_uuid": device_uuid or str(uuid.uuid4()),
        "clave_publica": clave_publica, "modelo": "Prueba", "pin": pin})


def login_pin(client, device_uuid: str, pin: str):
    return client.post("/auth/pin/login", json={"device_uuid": device_uuid, "pin": pin})


def acopiador_con_celular(client, admin, pin=PIN) -> dict:
    """Acopiador nuevo con celular vinculado (creó su PIN al activar) y sesión iniciada."""
    acop = crear_acopiador(client, admin)
    device = str(uuid.uuid4())
    r = activar(client, generar_codigo(client, admin, acop["id"]), device, pin=pin)
    assert r.status_code == 200, r.text
    r = login_pin(client, device, pin)
    assert r.status_code == 200, r.text
    return {**acop, "device_uuid": device, "token": r.json()["access_token"], "pin": pin}


# ----------------------------------------------------------------- sincronización (Fase 2)
def nueva_clave():
    """Par de claves ECDSA P-256 como las del Android Keystore: (privada, pública SPKI DER en base64)."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    privada = ec.generate_private_key(ec.SECP256R1())
    publica = privada.public_key().public_bytes(serialization.Encoding.DER,
                                                serialization.PublicFormat.SubjectPublicKeyInfo)
    return privada, base64.b64encode(publica).decode()


def firmar(privada, item: dict) -> dict:
    """Firma el ítem como lo hará el celular (cadena canónica v1, SHA256withECDSA, DER en base64)."""
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import ec

    from app.esquemas.sync import RecoleccionPush
    from app.firma import cadena_canonica

    cadena = cadena_canonica(RecoleccionPush.model_validate({k: v for k, v in item.items() if k != "firma"}))
    return {**item, "firma": base64.b64encode(privada.sign(cadena.encode(), ec.ECDSA(hashes.SHA256()))).decode()}


def movil_con_celular(client, admin, rol: str, pin=PIN) -> dict:
    """Acopiador o analista nuevo con celular vinculado (clave EC real) y sesión iniciada."""
    if rol == "acopiador":
        usuario = crear_acopiador(client, admin)
    else:
        r = client.post("/analistas", json={"nombre_completo": f"Analista Prueba {uuid.uuid4().hex[:6]}",
                                            "dni": dni(), "celular": celular()},
                        headers=cab(admin))
        assert r.status_code == 201, r.text
        usuario = r.json()
    privada, publica = nueva_clave()
    device = str(uuid.uuid4())
    r = activar(client, generar_codigo(client, admin, usuario["id"]), device, publica, pin=pin)
    assert r.status_code == 200, r.text
    r = login_pin(client, device, pin)
    assert r.status_code == 200, r.text
    return {**usuario, "device_uuid": device, "token": r.json()["access_token"], "clave": privada}


def crear_ruta_asignada(client, admin, acopiador_id: int) -> int:
    r = client.post("/rutas", json={"nombre": f"Ruta sync {uuid.uuid4().hex[:8]}"}, headers=cab(admin))
    assert r.status_code == 201, r.text
    ruta_id = r.json()["id"]
    r = client.put(f"/rutas/{ruta_id}/acopiador", json={"acopiador_id": acopiador_id}, headers=cab(admin))
    assert r.status_code == 200, r.text
    return ruta_id


def crear_productor(client, admin, ruta_id: int | None = None) -> dict:
    datos = {"nombre": f"Productor sync {uuid.uuid4().hex[:6]}", "tipo": "de_ruta", "ruta_id": ruta_id}
    if ruta_id is None:
        datos = {"nombre": datos["nombre"], "tipo": "externo", "documento": dni(), "celular": celular()}
    r = client.post("/productores", json=datos, headers=cab(admin))
    assert r.status_code == 201, r.text
    return r.json()


def item_recoleccion(movil: dict, productor_id: int | None = None, firmado: bool = True, **extra) -> dict:
    """Recolección como la arma el celular (con GPS en Huata y firmada con la clave del celular)."""
    from datetime import datetime, timezone

    item = {"id": str(uuid.uuid4()), "litros": round(random.uniform(5, 60), 2),
            "registrada_en": datetime.now(timezone.utc).isoformat(),
            "latitud": -15.614512, "longitud": -69.972310, "precision_m": 8.5, "origen_ubicacion": "gps",
            "ubicacion_simulada": False, "hora_automatica": True, "hash_anterior": None}
    if productor_id is not None:
        item["productor_id"] = productor_id
    item.update(extra)
    return firmar(movil["clave"], item) if firmado else item


def push(client, movil: dict, productores=(), recolecciones=()):
    r = client.post("/sync/push", json={"productores": list(productores), "recolecciones": list(recolecciones)},
                    headers=cab(movil["token"]))
    assert r.status_code == 200, r.text
    return r.json()
