"""Límite de contraseñas de admin fallidas por IP y CORS acotado al panel web (Bloque W1, paso 0)."""
from app.config import config
from app.routers.auth import LOGIN_ADMIN_MAX_FALLOS, reiniciar_limites
from conftest import ADMIN_EMAIL, ADMIN_PASSWORD


def login(client, password: str, email: str = ADMIN_EMAIL):
    return client.post("/auth/admin/login", json={"email": email, "password": password})


def test_la_contrasena_fallida_numero_11_da_429(client):
    assert LOGIN_ADMIN_MAX_FALLOS == 10
    for _ in range(LOGIN_ADMIN_MAX_FALLOS):
        r = login(client, "incorrecta")
        assert r.status_code == 401
        assert r.json()["mensaje"] == "Correo o contraseña incorrectos"
    r = login(client, "incorrecta")
    assert r.status_code == 429
    assert r.json()["codigo"] == "demasiados_intentos"

    # Con el límite alcanzado, ni la contraseña correcta pasa: se corta antes de revisarla
    assert login(client, ADMIN_PASSWORD).status_code == 429


def test_correo_inexistente_tambien_cuenta(client):
    for _ in range(LOGIN_ADMIN_MAX_FALLOS):
        assert login(client, "x", email="nadie@queseria.test").status_code == 401
    assert login(client, ADMIN_PASSWORD).status_code == 429


def test_un_login_correcto_no_suma_y_reiniciar_restablece(client):
    for _ in range(LOGIN_ADMIN_MAX_FALLOS - 1):             # 9 fallos: queda uno antes del límite
        assert login(client, "incorrecta").status_code == 401
    assert login(client, ADMIN_PASSWORD).status_code == 200  # el acierto no suma
    assert login(client, "incorrecta").status_code == 401   # 10.º fallo
    assert login(client, ADMIN_PASSWORD).status_code == 429

    reiniciar_limites()
    assert login(client, ADMIN_PASSWORD).status_code == 200


def test_el_limite_del_login_no_afecta_a_las_peticiones_con_token(client, admin):
    for _ in range(LOGIN_ADMIN_MAX_FALLOS):
        login(client, "incorrecta")
    r = client.get("/acopiadores", headers={"Authorization": admin["Authorization"]})
    assert r.status_code == 200


# ----------------------------------------------------------------- CORS
def _origen_permitido() -> str:
    return [o.strip() for o in config().cors_origenes.split(",") if o.strip()][0]


def _preflight(client, origen: str, metodo: str = "POST", cabeceras: str = "authorization,content-type"):
    return client.options("/auth/admin/login", headers={
        "Origin": origen,
        "Access-Control-Request-Method": metodo,
        "Access-Control-Request-Headers": cabeceras,
    })


def test_preflight_del_panel_web_permitido(client):
    origen = _origen_permitido()
    r = _preflight(client, origen)
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == origen
    assert "access-control-allow-credentials" not in r.headers
    permitidas = r.headers["access-control-allow-headers"].lower()
    assert "authorization" in permitidas and "content-type" in permitidas


def test_preflight_de_otro_origen_rechazado(client):
    r = _preflight(client, "http://sitio-ajeno.example")
    assert r.status_code == 400
    assert "access-control-allow-origin" not in r.headers


def test_preflight_con_metodo_o_cabecera_no_permitidos(client):
    origen = _origen_permitido()
    assert _preflight(client, origen, metodo="TRACE").status_code == 400
    assert _preflight(client, origen, cabeceras="x-otra-cabecera").status_code == 400


def test_respuesta_simple_lleva_el_origen_solo_si_es_permitido(client):
    origen = _origen_permitido()
    assert client.get("/salud", headers={"Origin": origen}).headers["access-control-allow-origin"] == origen
    assert "access-control-allow-origin" not in client.get(
        "/salud", headers={"Origin": "http://sitio-ajeno.example"}).headers
