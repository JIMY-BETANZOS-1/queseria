"""Editor de recetas: POST /recetas, PATCH /recetas/{id} y PUT /recetas/{id}/insumos.

queseria_test no se recrea: cada prueba usa recetas e insumos con nombres únicos. Para "la receta ya tiene lotes"
basta un lote en proceso insertado directo (sin leche): v_lote_resumen ya lo muestra con su vencimiento.
"""
import uuid
from datetime import date

import pytest

from conftest import cab, movil_con_celular


def insumo(client, admin, unidad="g") -> int:
    r = client.post("/insumos", json={"nombre": f"Insumo receta {uuid.uuid4().hex[:8]}", "unidad": unidad}, headers=cab(admin))
    assert r.status_code == 201, r.text
    return r.json()["insumo_id"]


def nueva(client, admin, **extra) -> dict:
    datos = {"nombre": f"Queso prueba editor {uuid.uuid4().hex[:8]}", "unidad_venta": "unidad", "precio_venta": 20,
             "litros_base": 100, "rendimiento_base": 10, "dias_vida_util": 7, **extra}
    r = client.post("/recetas", json=datos, headers=cab(admin))
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def con_lote(client, admin, db):
    receta = nueva(client, admin)
    lote = db.execute("""
        INSERT INTO lote_produccion (codigo, receta_id, fecha_produccion, creado_por)
        VALUES (%s, %s, DATE '2026-10-01', %s) RETURNING id
    """, (f"PRUEBA-REC-{uuid.uuid4().hex[:6]}", receta["id"], int(admin["id"]))).fetchone()["id"]
    return {"receta": receta, "lote": lote}


def test_crear_con_insumos_y_aparece_en_la_lista(client, admin):
    a, b = insumo(client, admin), insumo(client, admin, "kg")
    r = nueva(client, admin, insumos=[{"insumo_id": a, "cantidad": 20}, {"insumo_id": b, "cantidad": 1.5}])
    assert r["unidad_venta"] == "unidad" and r["litros_base"] == 100 and r["dias_vida_util"] == 7 and r["activa"] is True and r["n_lotes"] == 0
    assert sorted((i["insumo_id"], i["cantidad"]) for i in r["insumos"]) == sorted([(a, 20), (b, 1.5)])
    lista = client.get("/recetas", headers=cab(admin)).json()
    assert next(x for x in lista if x["id"] == r["id"]) == r


def test_lo_que_rechaza_la_base_o_el_backend(client, admin):
    h = cab(admin)
    a = insumo(client, admin)
    existente = nueva(client, admin)
    casos = [
        ({"nombre": existente["nombre"], "unidad_venta": "kilo"}, 409, "Ya existe una receta con ese nombre"),
        ({"nombre": f"X {uuid.uuid4().hex[:6]}", "unidad_venta": "kilo", "litros_base": 0}, 409,
         "Los litros base deben ser mayores que cero"),
        ({"nombre": f"X {uuid.uuid4().hex[:6]}", "unidad_venta": "kilo", "precio_venta": -1}, 409,
         "El precio de venta no puede ser negativo"),
        ({"nombre": f"X {uuid.uuid4().hex[:6]}", "unidad_venta": "kilo", "dias_vida_util": 0}, 409,
         "La vida útil debe ser de al menos un día"),
        ({"nombre": f"X {uuid.uuid4().hex[:6]}", "unidad_venta": "kilo", "insumos": [{"insumo_id": a, "cantidad": 0}]}, 409,
         "La cantidad de cada insumo debe ser mayor que cero"),
        ({"nombre": f"X {uuid.uuid4().hex[:6]}", "unidad_venta": "kilo",
          "insumos": [{"insumo_id": a, "cantidad": 1}, {"insumo_id": a, "cantidad": 2}]}, 409, "Un insumo está repetido en la receta"),
        ({"nombre": f"X {uuid.uuid4().hex[:6]}", "unidad_venta": "kilo", "insumos": [{"insumo_id": 999999999, "cantidad": 1}]},
         409, "El insumo n.º 999999999 no existe o está inactivo"),
    ]
    for datos, status, mensaje in casos:
        r = client.post("/recetas", json=datos, headers=h)
        assert (r.status_code, r.json()["mensaje"]) == (status, mensaje), datos
    assert client.post("/recetas", json={"nombre": "Y", "unidad_venta": "litro"}, headers=h).status_code == 422
    assert client.post("/recetas", json={"nombre": "  ", "unidad_venta": "kilo"}, headers=h).status_code == 422
    # Nada quedó a medias: ninguna receta "X …" con insumo repetido o inexistente
    assert not [x for x in client.get("/recetas", headers=h).json() if x["nombre"].startswith("X ")
                and any(i["insumo_id"] == 999999999 for i in x["insumos"])]


def test_cambiar_sin_lotes_cambia_todo(client, admin):
    receta = nueva(client, admin)
    r = client.patch(f"/recetas/{receta['id']}", json={"rendimiento_base": 12.5, "dias_vida_util": 10, "unidad_venta": "kilo",
                                                       "precio_venta": None}, headers=cab(admin))
    assert r.status_code == 200, r.text
    assert (r.json()["rendimiento_base"], r.json()["dias_vida_util"], r.json()["unidad_venta"], r.json()["precio_venta"]) == \
        (12.5, 10, "kilo", None)
    assert client.patch(f"/recetas/{receta['id']}", json={}, headers=cab(admin)).status_code == 422
    assert client.patch(f"/recetas/{receta['id']}", json={"nombre": None}, headers=cab(admin)).status_code == 422
    assert client.patch("/recetas/999999999", json={"activa": False}, headers=cab(admin)).status_code == 404


def test_con_lotes_no_cambia_lo_que_altera_sus_lotes(client, admin, db, con_lote):
    h = cab(admin)
    rid = con_lote["receta"]["id"]
    vence = lambda: db.execute("SELECT fecha_vencimiento FROM v_lote_resumen WHERE lote_id = %s",  # noqa: E731
                               (con_lote["lote"],)).fetchone()["fecha_vencimiento"]
    assert vence() == date(2026, 10, 8)
    # La web lo sabe antes de intentar: n_lotes en la receta
    assert next(x for x in client.get("/recetas", headers=h).json() if x["id"] == rid)["n_lotes"] == 1
    for campo, valor, texto in [("dias_vida_util", 30, "la vida útil"), ("rendimiento_base", 11, "el rendimiento"),
                                ("litros_base", 50, "los litros base"), ("unidad_venta", "kilo", "la unidad de venta")]:
        r = client.patch(f"/recetas/{rid}", json={campo: valor}, headers=h)
        assert r.status_code == 409, campo
        assert r.json()["mensaje"] == (f"La receta ya tiene 1 lote: cambiar {texto} alteraría lo que se muestra de ellos "
                                       "(rendimiento teórico, vencimiento o unidad). Cree una receta nueva y desactive esta.")
    assert vence() == date(2026, 10, 8)
    # El mismo valor que ya tiene no es un cambio; nombre, precio y activa sí se pueden cambiar
    r = client.patch(f"/recetas/{rid}", json={"dias_vida_util": 7, "litros_base": 100.0, "precio_venta": 22.5,
                                              "activa": False, "nombre": con_lote["receta"]["nombre"] + " (vieja)"}, headers=h)
    assert r.status_code == 200, r.text
    assert (r.json()["precio_venta"], r.json()["activa"]) == (22.5, False) and r.json()["nombre"].endswith(" (vieja)")
    assert vence() == date(2026, 10, 8)


def test_reemplazar_insumos_no_toca_los_lotes(client, admin, db, con_lote):
    h = cab(admin)
    rid = con_lote["receta"]["id"]
    a, b = insumo(client, admin), insumo(client, admin)
    r = client.put(f"/recetas/{rid}/insumos", json={"insumos": [{"insumo_id": a, "cantidad": 3}]}, headers=h)
    assert r.status_code == 200 and [(i["insumo_id"], i["cantidad"]) for i in r.json()["insumos"]] == [(a, 3)]
    costo = lambda: db.execute("SELECT costo_total FROM v_lote_resumen WHERE lote_id = %s",  # noqa: E731
                               (con_lote["lote"],)).fetchone()["costo_total"]
    antes = costo()
    r = client.put(f"/recetas/{rid}/insumos", json={"insumos": [{"insumo_id": b, "cantidad": 2}, {"insumo_id": a, "cantidad": 4}]},
                   headers=h)
    assert r.status_code == 200 and sorted((i["insumo_id"], i["cantidad"]) for i in r.json()["insumos"]) == sorted([(a, 4), (b, 2)])
    assert costo() == antes
    # Si algo falla, no queda a medias
    r = client.put(f"/recetas/{rid}/insumos", json={"insumos": [{"insumo_id": a, "cantidad": 1}, {"insumo_id": b, "cantidad": 0}]},
                   headers=h)
    assert r.status_code == 409 and r.json()["mensaje"] == "La cantidad de cada insumo debe ser mayor que cero"
    lista = next(x for x in client.get("/recetas", headers=h).json() if x["id"] == rid)
    assert sorted((i["insumo_id"], i["cantidad"]) for i in lista["insumos"]) == sorted([(a, 4), (b, 2)])
    # Vacía: la receta queda sin insumos
    assert client.put(f"/recetas/{rid}/insumos", json={"insumos": []}, headers=h).json()["insumos"] == []
    assert client.put("/recetas/999999999/insumos", json={"insumos": []}, headers=h).status_code == 404


def test_solo_admin(client, admin):
    t = cab(movil_con_celular(client, admin, "acopiador")["token"])
    assert client.post("/recetas", json={}, headers=t).status_code == 403
    assert client.patch("/recetas/1", json={}, headers=t).status_code == 403
    assert client.put("/recetas/1/insumos", json={"insumos": []}, headers=t).status_code == 403
