"""POST /sync/calidad y la foto del análisis."""
import pytest

from app.config import config
from conftest import cab, crear_productor, crear_ruta_asignada, item_recoleccion, movil_con_celular, push

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture(scope="module")
def equipo(client, admin):
    acop = movil_con_celular(client, admin, "acopiador")
    acop["ruta_id"] = crear_ruta_asignada(client, admin, acop["id"])
    return {"acop": acop, "analista": movil_con_celular(client, admin, "analista")}


@pytest.fixture
def recoleccion(client, admin, equipo) -> dict:
    """Una recolección recién registrada por el acopiador, de un productor sin historial."""
    acop = equipo["acop"]
    prod = crear_productor(client, admin, acop["ruta_id"])
    item = item_recoleccion(acop, prod["id"])
    assert push(client, acop, recolecciones=[item])["recolecciones"][0]["estado"] == "creado"
    return {"id": item["id"], "productor_id": prod["id"]}


def calidad(client, analista, *revisiones):
    r = client.post("/sync/calidad", json={"revisiones": list(revisiones)}, headers=cab(analista["token"]))
    assert r.status_code == 200, r.text
    return r.json()["revisiones"]


def test_normal_confirma_revision_idempotente(client, equipo, recoleccion, db):
    analista = equipo["analista"]
    r = calidad(client, analista, {"recoleccion_id": recoleccion["id"]})[0]
    assert r["estado"] == "creado" and r["sancion"] is None
    fila = db.execute("SELECT estado_calidad, calidad_por, calidad_en FROM recoleccion WHERE id = %s",
                      (recoleccion["id"],)).fetchone()
    assert fila["estado_calidad"] == "normal" and fila["calidad_por"] == analista["id"]
    assert fila["calidad_en"] is not None

    # Reenvío (o intento de cambiarla): duplicado, no se sobrescribe
    r = calidad(client, analista, {"recoleccion_id": recoleccion["id"], "estado": "alterado", "ph": 5.1})[0]
    assert r["estado"] == "duplicado"
    assert db.execute("SELECT estado_calidad FROM recoleccion WHERE id = %s",
                      (recoleccion["id"],)).fetchone()["estado_calidad"] == "normal"


def test_alterado_sin_analisis_error_traducido(client, equipo, recoleccion, db):
    r = calidad(client, equipo["analista"], {"recoleccion_id": recoleccion["id"], "estado": "alterado"})[0]
    assert r["estado"] == "rechazado"
    assert r["motivo"] == f"La recolección {recoleccion['id']} alterada requiere su análisis de calidad"
    fila = db.execute("SELECT estado_calidad, calidad_en FROM recoleccion WHERE id = %s",
                      (recoleccion["id"],)).fetchone()
    assert fila == {"estado_calidad": "normal", "calidad_en": None}       # se revirtió todo el ítem


def test_alterado_correcto_crea_sancion(client, equipo, recoleccion, db):
    r = calidad(client, equipo["analista"], {"recoleccion_id": recoleccion["id"], "estado": "alterado",
                                             "ph": 6.1, "temperatura_c": 9.5, "antibioticos_positivo": True})[0]
    assert r["estado"] == "creado", r
    hoy = db.execute("SELECT (now() AT TIME ZONE 'America/Lima')::date AS hoy").fetchone()["hoy"]
    assert r["sancion"]["tipo"] == "precio"
    assert r["sancion"]["desde"] == str(hoy.fromordinal(hoy.toordinal() + 1))
    assert r["sancion"]["hasta"] == str(hoy.fromordinal(hoy.toordinal() + 7))
    a = db.execute("SELECT ph, antibioticos_positivo FROM analisis_calidad WHERE recoleccion_id = %s",
                   (recoleccion["id"],)).fetchone()
    assert float(a["ph"]) == 6.1 and a["antibioticos_positivo"] is True


def test_lote_mixto_y_recoleccion_inexistente(client, equipo, recoleccion):
    res = calidad(client, equipo["analista"],
                  {"recoleccion_id": "00000000-0000-0000-0000-000000000000"},
                  {"recoleccion_id": recoleccion["id"], "estado": "alterado", "ph": 99},   # fuera del check
                  {"recoleccion_id": recoleccion["id"]},
                  {"estado": "normal"})
    assert [r["estado"] for r in res] == ["rechazado", "rechazado", "creado", "rechazado"]
    assert res[0]["motivo"] == "La recolección no existe"
    assert res[1]["motivo"] == "El pH debe estar entre 0 y 14"


def test_solo_el_analista_revisa(client, equipo):
    r = client.post("/sync/calidad", json={"revisiones": []}, headers=cab(equipo["acop"]["token"]))
    assert r.status_code == 403


def test_foto_y_alterado_solo_con_foto(client, admin, equipo, recoleccion, db):
    analista = equipo["analista"]
    r = client.post(f"/analisis/{recoleccion['id']}/foto", files={"archivo": ("tarro.png", PNG, "image/png")},
                    headers=cab(analista["token"]))
    assert r.status_code == 200, r.text
    foto_url = r.json()["foto_url"]
    assert foto_url.startswith("analisis/") and foto_url.endswith(".png")
    assert (config().storage_dir / foto_url).read_bytes() == PNG

    # La foto basta como análisis de una alterada
    rev = calidad(client, analista, {"recoleccion_id": recoleccion["id"], "estado": "alterado"})[0]
    assert rev["estado"] == "creado", rev
    assert db.execute("SELECT foto_url FROM analisis_calidad WHERE recoleccion_id = %s",
                      (recoleccion["id"],)).fetchone()["foto_url"] == foto_url

    r = client.get(f"/analisis/{recoleccion['id']}/foto", headers=cab(admin))
    assert r.status_code == 200 and r.content == PNG and r.headers["content-type"] == "image/png"


def test_foto_rechaza_no_imagen_grande_y_rol(client, equipo, recoleccion, monkeypatch):
    analista = equipo["analista"]
    url = f"/analisis/{recoleccion['id']}/foto"
    r = client.post(url, files={"archivo": ("x.png", b"esto no es una imagen", "image/png")},
                    headers=cab(analista["token"]))
    assert r.status_code == 422 and "JPEG, PNG o WebP" in r.json()["mensaje"]

    monkeypatch.setattr(config(), "foto_max_mb", 1)
    grande = b"\xff\xd8\xff" + b"\x00" * (1024 * 1024)
    r = client.post(url, files={"archivo": ("x.jpg", grande, "image/jpeg")}, headers=cab(analista["token"]))
    assert r.status_code == 413

    r = client.post(url, files={"archivo": ("x.png", PNG, "image/png")}, headers=cab(equipo["acop"]["token"]))
    assert r.status_code == 403

    r = client.post("/analisis/00000000-0000-0000-0000-000000000000/foto",
                    files={"archivo": ("x.png", PNG, "image/png")}, headers=cab(analista["token"]))
    assert r.status_code == 404
