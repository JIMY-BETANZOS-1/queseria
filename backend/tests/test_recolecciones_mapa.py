"""Datos del mapa de recolección: GET /recolecciones (y las demás que devuelven el detalle) traen la ubicación de
referencia del productor y la distancia a la entrega, calculada con fn_distancia_m de la base."""
import pytest

from conftest import cab, crear_productor, crear_ruta_asignada, item_recoleccion, movil_con_celular, push

LAT, LON = -15.614512, -69.972310          # la de item_recoleccion por defecto (Huata)


@pytest.fixture(scope="module")
def entregas(client, admin):
    """Un productor nuevo: la 1.ª entrega con buen GPS fija su referencia; la 2.ª, unos 500 m al norte; la 3.ª,
    sin GPS. Otro productor nuevo con una sola entrega sin GPS (queda sin referencia)."""
    acop = movil_con_celular(client, admin, "acopiador")
    ruta = crear_ruta_asignada(client, admin, acop["id"])
    prod = crear_productor(client, admin, ruta)
    sin_ref = crear_productor(client, admin, ruta)
    sin_gps = {"latitud": None, "longitud": None, "precision_m": None, "origen_ubicacion": "ninguna"}
    primera = item_recoleccion(acop, prod["id"], litros=10)
    push(client, acop, recolecciones=[primera])     # primero, para que fije la referencia
    lejos = item_recoleccion(acop, prod["id"], litros=11, latitud=LAT + 0.0045)
    ninguna = item_recoleccion(acop, prod["id"], litros=12, **sin_gps)
    otra = item_recoleccion(acop, sin_ref["id"], litros=13, **sin_gps)
    push(client, acop, recolecciones=[lejos, ninguna, otra])
    return {"acop": acop["id"], "prod": prod, "sin_ref": sin_ref, "primera": primera["id"], "lejos": lejos["id"],
            "ninguna": ninguna["id"], "otra": otra["id"]}


def por_id(filas: list[dict]) -> dict:
    return {f["recoleccion_id"]: f for f in filas}


def test_referencia_y_distancia_con_la_funcion_de_la_base(client, admin, db, entregas):
    filas = por_id(client.get(f"/recolecciones?productor_id={entregas['prod']['id']}", headers=cab(admin)).json())
    primera, lejos, ninguna = filas[entregas["primera"]], filas[entregas["lejos"]], filas[entregas["ninguna"]]

    # La primera entrega con buen GPS fija la referencia del productor: distancia 0
    assert (primera["latitud_ref"], primera["longitud_ref"]) == (pytest.approx(LAT), pytest.approx(LON))
    assert primera["distancia_ref_m"] == 0

    esperada = float(db.execute("SELECT round(fn_distancia_m(%s::numeric, %s::numeric, %s::numeric, %s::numeric), 1) AS d",
                                (LAT, LON, LAT + 0.0045, LON)).fetchone()["d"])
    assert lejos["distancia_ref_m"] == pytest.approx(esperada) and 480 < lejos["distancia_ref_m"] < 520
    assert lejos["latitud_ref"] == pytest.approx(LAT)

    # Sin GPS: la referencia sí, la distancia no
    assert ninguna["latitud"] is None and ninguna["distancia_ref_m"] is None
    assert ninguna["latitud_ref"] == pytest.approx(LAT)


def test_productor_sin_referencia(client, admin, entregas):
    fila = por_id(client.get(f"/recolecciones?productor_id={entregas['sin_ref']['id']}", headers=cab(admin)).json())[entregas["otra"]]
    assert (fila["latitud_ref"], fila["longitud_ref"], fila["distancia_ref_m"]) == (None, None, None)


def test_los_demas_detalles_traen_los_mismos_campos(client, admin, entregas):
    h = cab(admin)
    # Detalle por productor
    del_productor = por_id(client.get(f"/productores/{entregas['prod']['id']}/recolecciones", headers=h).json())
    assert del_productor[entregas["lejos"]]["distancia_ref_m"] > 480
    # Lista de calidad (sin revisar)
    sin_revisar = por_id(client.get(f"/recolecciones/sin-revisar?registrado_por={entregas['acop']}", headers=h).json())
    assert sin_revisar[entregas["lejos"]]["distancia_ref_m"] > 480
    # Revisar calidad y anular devuelven el detalle con la distancia
    r = client.post(f"/recolecciones/{entregas['lejos']}/calidad", json={}, headers=h)
    assert r.status_code == 200 and r.json()["recoleccion"]["distancia_ref_m"] > 480
    r = client.post(f"/recolecciones/{entregas['lejos']}/anular", json={"motivo": "Prueba del mapa"}, headers=h)
    assert r.status_code == 200 and r.json()["distancia_ref_m"] > 480 and r.json()["latitud_ref"] == pytest.approx(LAT)
