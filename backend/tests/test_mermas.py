"""Merma de leche: GET /mermas y POST /mermas (solo listar y registrar).

queseria_test no se recrea: cada prueba usa leche propia de un día pasado al azar, y mide lo disponible de la
jornada antes de mermar (otras pruebas pueden haber dejado leche ese mismo día).
"""
import random
from datetime import date, datetime, timedelta, timezone

import pytest

from conftest import cab, crear_productor, crear_ruta_asignada, item_recoleccion, movil_con_celular, push


@pytest.fixture
def jornada(client, admin, db):
    """40 L aprobados y 10 L sin revisar de un día pasado al azar; devuelve el día y su fila de v_leche_jornada."""
    acop = movil_con_celular(client, admin, "acopiador")
    prod = crear_productor(client, admin, crear_ruta_asignada(client, admin, acop["id"]))
    dia = date(2026, 1, 1) + timedelta(days=random.randint(0, 270))   # con precio vigente (desde 2026-01-01)
    registrada = (datetime.combine(dia, datetime.min.time(), timezone.utc) + timedelta(hours=15)).isoformat()
    aprobada = item_recoleccion(acop, prod["id"], litros=40, registrada_en=registrada)
    sin_revisar = item_recoleccion(acop, prod["id"], litros=10, registrada_en=registrada)
    push(client, acop, recolecciones=[aprobada, sin_revisar])
    assert client.post(f"/recolecciones/{aprobada['id']}/calidad", json={}, headers=cab(admin)).status_code == 200
    return {"dia": dia, "fila": lambda: db.execute("SELECT * FROM v_leche_jornada WHERE fecha = %s", (dia,)).fetchone()}


def test_registrar_baja_lo_disponible_y_suma_a_la_perdida_del_mes(client, admin, db, jornada):
    h = cab(admin)
    antes = jornada["fila"]()
    mes = date(jornada["dia"].year, jornada["dia"].month, 1)
    perdida_antes = db.execute("SELECT perdida_leche FROM v_resultado_mensual WHERE mes = %s", (mes,)).fetchone()
    perdida_antes = float(perdida_antes["perdida_leche"]) if perdida_antes else 0.0

    r = client.post("/mermas", json={"fecha": jornada["dia"].isoformat(), "litros": 12.5, "motivo": "  Se derramó un porongo "},
                    headers=h)
    assert r.status_code == 201, r.text
    m = r.json()
    assert m["litros"] == 12.5 and m["motivo"] == "Se derramó un porongo"
    assert m["registrado_por"] == int(admin["id"])
    despues = jornada["fila"]()
    assert float(despues["litros_disponibles"]) == pytest.approx(float(antes["litros_disponibles"]) - 12.5)
    assert float(despues["litros_merma"]) == pytest.approx(float(antes["litros_merma"]) + 12.5)
    assert m["valor_perdida"] == pytest.approx(round(12.5 * float(despues["costo_litro_util"]), 2))
    perdida = float(db.execute("SELECT perdida_leche FROM v_resultado_mensual WHERE mes = %s", (mes,)).fetchone()["perdida_leche"])
    assert perdida == pytest.approx(perdida_antes + m["valor_perdida"], abs=0.01)

    lista = client.get(f"/mermas?desde={jornada['dia']}&hasta={jornada['dia']}", headers=h).json()
    assert m["id"] in [x["id"] for x in lista] and all(x["fecha"] == jornada["dia"].isoformat() for x in lista)


def test_lo_que_rechaza_la_base_vuelve_como_409(client, admin, jornada):
    h = cab(admin)
    dia = jornada["dia"].isoformat()
    disponible = float(jornada["fila"]()["litros_disponibles"])
    # Más que lo aprobado sin destino (los 10 L sin revisar no cuentan)
    r = client.post("/mermas", json={"fecha": dia, "litros": disponible + 0.5, "motivo": "Prueba"}, headers=h)
    assert r.status_code == 409 and r.json()["mensaje"].startswith("La merma supera la leche aprobada sin destino de la jornada")
    for litros in (0, -3):
        r = client.post("/mermas", json={"fecha": dia, "litros": litros, "motivo": "Prueba"}, headers=h)
        assert r.status_code == 409 and r.json()["mensaje"] == "Los litros de la merma deben ser mayores que cero"
    # Jornada sin leche
    r = client.post("/mermas", json={"fecha": "1990-01-01", "litros": 1, "motivo": "Prueba"}, headers=h)
    assert r.status_code == 409 and "1990-01-01" in r.json()["mensaje"]
    # Todo lo disponible sí se puede; después ya no queda nada
    assert client.post("/mermas", json={"fecha": dia, "litros": disponible, "motivo": "Se agrió"}, headers=h).status_code == 201
    assert float(jornada["fila"]()["litros_disponibles"]) == 0
    assert client.post("/mermas", json={"fecha": dia, "litros": 0.01, "motivo": "Prueba"}, headers=h).status_code == 409


def test_motivo_obligatorio_y_rango(client, admin):
    h = cab(admin)
    assert client.post("/mermas", json={"fecha": "2026-01-01", "litros": 1, "motivo": "   "}, headers=h).status_code == 422
    assert client.post("/mermas", json={"fecha": "2026-01-01", "litros": 1}, headers=h).status_code == 422
    assert client.get("/mermas?desde=2026-02-01&hasta=2026-01-01", headers=h).status_code == 422
    assert client.get("/mermas?desde=2024-01-01&hasta=2026-01-01", headers=h).status_code == 422


def test_solo_admin(client, admin):
    t = cab(movil_con_celular(client, admin, "acopiador")["token"])
    assert client.get("/mermas?desde=2026-01-01&hasta=2026-01-01", headers=t).status_code == 403
    assert client.post("/mermas", json={}, headers=t).status_code == 403
