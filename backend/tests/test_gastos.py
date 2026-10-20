"""Gastos operativos: GET /categorias-gasto, GET /gastos y POST /gastos (solo listar y registrar)."""
import uuid

from conftest import cab, crear_acopiador, movil_con_celular


def categoria(client, admin, nombre: str) -> dict:
    return next(c for c in client.get("/categorias-gasto", headers=cab(admin)).json() if c["nombre"] == nombre)


def test_categorias_marcan_la_del_pago_mensual(client, admin):
    cats = {c["nombre"]: c["manual"] for c in client.get("/categorias-gasto", headers=cab(admin)).json()}
    assert cats["Sueldo acopiador"] is False
    assert cats["Combustible"] is True and cats["Otros"] is True


def test_registrar_y_listar(client, admin, db):
    h = cab(admin)
    acop = crear_acopiador(client, admin)
    descripcion = f"Gasolina ruta {uuid.uuid4().hex[:6]}"
    r = client.post("/gastos", json={"fecha": "2026-03-10", "categoria_id": categoria(client, admin, "Combustible")["id"],
                                     "descripcion": descripcion, "monto": 45.5, "acopiador_id": acop["id"]}, headers=h)
    assert r.status_code == 201, r.text
    g = r.json()
    assert g["categoria"] == "Combustible" and g["monto"] == 45.5 and g["acopiador"] == acop["nombre_completo"]
    assert g["registrado_por"] == int(admin["id"]) and g["del_pago_mensual"] is False

    # Sin fecha: hoy en Lima (no la fecha del servidor de la base)
    r = client.post("/gastos", json={"categoria_id": categoria(client, admin, "Otros")["id"], "monto": 10}, headers=h)
    hoy_lima = db.execute("SELECT (now() AT TIME ZONE 'America/Lima')::date AS d").fetchone()["d"]
    assert r.status_code == 201 and r.json()["fecha"] == hoy_lima.isoformat() and r.json()["acopiador"] is None

    lista = client.get("/gastos?desde=2026-03-10&hasta=2026-03-10", headers=h).json()
    assert g["id"] in [x["id"] for x in lista]
    assert all(x["fecha"] == "2026-03-10" for x in lista)


def test_el_gasto_del_pago_mensual_se_lista_marcado(client, admin, db):
    h = cab(admin)
    acop = crear_acopiador(client, admin, sueldo_base_mensual=300, comision_por_litro=0)
    pago = client.post("/pagos/acopiadores", json={"acopiador_id": acop["id"], "mes": "2026-02-01"}, headers=h).json()
    pagado = client.post(f"/pagos/acopiadores/{pago['id']}/pagar", headers=h).json()
    hoy_lima = db.execute("SELECT (now() AT TIME ZONE 'America/Lima')::date AS d").fetchone()["d"].isoformat()
    lista = client.get(f"/gastos?desde={hoy_lima}&hasta={hoy_lima}", headers=h).json()
    fila = next(x for x in lista if x["id"] == pagado["gasto_id"])
    assert fila["del_pago_mensual"] is True and fila["categoria"] == "Sueldo acopiador"


def test_lo_que_se_rechaza(client, admin):
    h = cab(admin)
    otros = categoria(client, admin, "Otros")["id"]
    r = client.post("/gastos", json={"categoria_id": categoria(client, admin, "Sueldo acopiador")["id"], "monto": 900},
                    headers=h)
    assert r.status_code == 409 and "solo los crea el pago mensual del acopiador" in r.json()["mensaje"]
    for monto in (0, -5):
        r = client.post("/gastos", json={"categoria_id": otros, "monto": monto}, headers=h)
        assert r.status_code == 409 and r.json()["mensaje"] == "El monto del gasto debe ser mayor que cero"
    r = client.post("/gastos", json={"categoria_id": 999999, "monto": 5}, headers=h)
    assert r.status_code == 422 and r.json()["mensaje"] == "La categoría de gasto no existe"
    r = client.post("/gastos", json={"categoria_id": otros, "monto": 5, "acopiador_id": 999999999}, headers=h)
    assert r.status_code == 422 and r.json()["mensaje"] == "El acopiador no existe"
    r = client.get("/gastos?desde=2026-03-10&hasta=2026-03-01", headers=h)
    assert r.status_code == 422 and r.json()["mensaje"] == "La fecha final no puede ser anterior a la inicial"
    assert client.get("/gastos?desde=2020-01-01&hasta=2026-01-01", headers=h).status_code == 422
    # No hay editar ni eliminar
    assert client.delete("/gastos/1", headers=h).status_code in (404, 405)
    assert client.patch("/gastos/1", json={"monto": 1}, headers=h).status_code in (404, 405)


def test_solo_admin(client, admin):
    t = cab(movil_con_celular(client, admin, "acopiador")["token"])
    assert client.get("/categorias-gasto", headers=t).status_code == 403
    assert client.get("/gastos?desde=2026-01-01&hasta=2026-01-02", headers=t).status_code == 403
    assert client.post("/gastos", json={"categoria_id": 1, "monto": 5}, headers=t).status_code == 403
