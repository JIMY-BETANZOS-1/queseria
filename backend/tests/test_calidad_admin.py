"""Revisión de calidad hecha por el admin: GET /recolecciones/sin-revisar y POST /recolecciones/{id}/calidad."""
import uuid

import pytest

from conftest import cab, crear_productor, crear_ruta_asignada, item_recoleccion, movil_con_celular, push


@pytest.fixture(scope="module")
def acop(client, admin):
    movil = movil_con_celular(client, admin, "acopiador")
    movil["ruta_id"] = crear_ruta_asignada(client, admin, movil["id"])
    return movil


@pytest.fixture
def recoleccion(client, admin, acop) -> dict:
    prod = crear_productor(client, admin, acop["ruta_id"])
    item = item_recoleccion(acop, prod["id"])
    assert push(client, acop, recolecciones=[item])["recolecciones"][0]["estado"] == "creado"
    return {"id": item["id"], "productor_id": prod["id"]}


def revisar(client, admin, recoleccion_id, **datos):
    return client.post(f"/recolecciones/{recoleccion_id}/calidad", json=datos, headers=cab(admin))


def test_sin_revisar_y_marcar_normal(client, admin, acop, recoleccion, db):
    h = cab(admin)
    lista = client.get(f"/recolecciones/sin-revisar?registrado_por={acop['id']}", headers=h).json()
    fila = next(r for r in lista if r["recoleccion_id"] == recoleccion["id"])
    assert fila["revisada"] is False and fila["registrado_por_nombre"] == acop["nombre_completo"]

    r = revisar(client, admin, recoleccion["id"])
    assert r.status_code == 200, r.text
    assert r.json()["recoleccion"]["revisada"] is True and r.json()["sancion"] is None
    calidad = db.execute("SELECT estado_calidad, calidad_por FROM recoleccion WHERE id = %s",
                         (recoleccion["id"],)).fetchone()
    assert calidad["estado_calidad"] == "normal" and calidad["calidad_por"] == int(admin["id"])

    lista = client.get(f"/recolecciones/sin-revisar?registrado_por={acop['id']}", headers=h).json()
    assert recoleccion["id"] not in [x["recoleccion_id"] for x in lista]

    r = revisar(client, admin, recoleccion["id"])
    assert r.status_code == 409 and r.json()["mensaje"] == "La recolección ya estaba revisada"


def test_alterada_exige_analisis_y_crea_sancion(client, admin, recoleccion, db):
    r = revisar(client, admin, recoleccion["id"], estado="alterado")
    assert r.status_code == 409
    assert "requiere su análisis de calidad" in r.json()["mensaje"]   # trigger diferido de la base
    assert db.execute("SELECT calidad_en FROM recoleccion WHERE id = %s",
                      (recoleccion["id"],)).fetchone()["calidad_en"] is None

    r = revisar(client, admin, recoleccion["id"], estado="alterado", ph=6.1, antibioticos_positivo=True)
    assert r.status_code == 200, r.text
    assert r.json()["recoleccion"]["estado_calidad"] == "alterado"
    assert r.json()["sancion"]["tipo"] == "precio"


def test_analisis_fuera_de_rango_lo_rechaza_la_base(client, admin, recoleccion):
    r = revisar(client, admin, recoleccion["id"], estado="alterado", ph=15)
    assert r.status_code == 422 and r.json()["mensaje"] == "El pH debe estar entre 0 y 14"


def test_inexistente_anulada_y_rol(client, admin, acop, recoleccion):
    assert revisar(client, admin, str(uuid.uuid4())).status_code == 404

    r = client.post(f"/recolecciones/{recoleccion['id']}/anular", json={"motivo": "Prueba"}, headers=cab(admin))
    assert r.status_code == 200, r.text
    r = revisar(client, admin, recoleccion["id"])
    assert r.status_code == 409 and r.json()["mensaje"] == "La recolección está anulada"

    assert client.get("/recolecciones/sin-revisar", headers=cab(acop["token"])).status_code == 403
    assert client.post(f"/recolecciones/{recoleccion['id']}/calidad", json={},
                       headers=cab(acop["token"])).status_code == 403
