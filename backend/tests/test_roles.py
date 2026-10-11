from conftest import acopiador_con_celular, cab


def test_acopiador_no_entra_a_rutas_del_admin(client, admin):
    acop = acopiador_con_celular(client, admin)
    r = client.get("/rutas", headers=cab(acop["token"]))
    assert r.status_code == 403
    assert r.json() == {"codigo": "prohibido", "mensaje": "No tiene permiso para esta operación"}
    assert client.post("/precios-leche", json={"tipo": "normal", "precio_litro": 9, "vigente_desde": "2030-01-01"},
                       headers=cab(acop["token"])).status_code == 403


def test_sin_token(client):
    r = client.get("/productores")
    assert r.status_code == 401
    assert r.json()["codigo"] == "no_autorizado"


def test_admin_no_usa_endpoints_moviles(client, admin):
    r = client.post("/auth/pin/cambiar", json={"pin_actual": "1234", "pin_nuevo": "4321"}, headers=cab(admin))
    assert r.status_code == 403
