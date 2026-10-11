from app import seguridad
from conftest import ADMIN_EMAIL, ADMIN_PASSWORD, cab


def test_login_admin_correcto(client):
    r = client.post("/auth/admin/login", json={"email": ADMIN_EMAIL.upper(), "password": ADMIN_PASSWORD})
    assert r.status_code == 200
    cuerpo = r.json()
    assert cuerpo["usuario"]["rol"] == "admin"
    assert cuerpo["expira_en_min"] == 30
    assert client.get("/rutas", headers=cab(cuerpo["access_token"])).status_code == 200


def test_login_admin_contrasena_incorrecta(client):
    r = client.post("/auth/admin/login", json={"email": ADMIN_EMAIL, "password": "otra"})
    assert r.status_code == 401
    assert r.json() == {"codigo": "no_autorizado", "mensaje": "Correo o contraseña incorrectos"}


def test_login_admin_correo_inexistente(client):
    r = client.post("/auth/admin/login", json={"email": "nadie@queseria.test", "password": ADMIN_PASSWORD})
    assert r.status_code == 401


def test_token_invalido_o_vencido(client, admin):
    assert client.get("/rutas", headers=cab("no-es-un-token")).status_code == 401
    vencido = seguridad.crear_token(int(admin["id"]), "admin", minutos=-1)
    r = client.get("/rutas", headers=cab(vencido))
    assert r.status_code == 401
    assert r.json()["mensaje"] == "Sesión inválida o vencida"
