import uuid

from conftest import cab, celular, dni


def test_precio_leche_historial(client, admin):
    h = cab(admin)
    r = client.post("/precios-leche", json={"tipo": "normal", "precio_litro": 1.85, "vigente_desde": "2099-01-01"},
                    headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["creado_por"] == int(admin["id"])
    r = client.post("/precios-leche", json={"tipo": "normal", "precio_litro": 1.90, "vigente_desde": "2099-01-01"},
                    headers=h)
    assert r.status_code == 409
    assert r.json()["mensaje"] == "Ya existe un precio de ese tipo con esa fecha de vigencia"
    r = client.post("/precios-leche", json={"tipo": "sancion", "precio_litro": 0, "vigente_desde": "2099-02-01"},
                    headers=h)
    assert r.status_code == 422
    historial = client.get("/precios-leche", headers=h).json()
    assert historial[0]["vigente_desde"] == "2099-01-01"
    assert {(p["tipo"], p["precio_litro"]) for p in historial} >= {("normal", 1.7), ("sancion", 0.7)}


def test_configuracion(client, admin, db):
    h = cab(admin)
    claves = {p["clave"]: p["valor"] for p in client.get("/configuracion", headers=h).json()}
    assert claves["dias_sancion"] == "7"

    r = client.put("/configuracion/max_velocidad_kmh", json={"valor": "90"}, headers=h)
    assert r.status_code == 200 and r.json()["valor"] == "90"
    aud = db.execute("SELECT usuario_id FROM auditoria WHERE tabla = 'configuracion' AND registro = 'max_velocidad_kmh' "
                     "ORDER BY id DESC LIMIT 1").fetchone()
    assert aud["usuario_id"] == int(admin["id"])

    r = client.put("/configuracion/max_velocidad_kmh", json={"valor": "rápido"}, headers=h)
    assert r.status_code == 422
    assert r.json()["mensaje"] == "El valor de 'max_velocidad_kmh' debe ser entero"
    assert client.put("/configuracion/pagar_leche_alterada", json={"valor": "si"}, headers=h).status_code == 422
    assert client.put("/configuracion/no_existe", json={"valor": "1"}, headers=h).status_code == 404

    client.put("/configuracion/max_velocidad_kmh", json={"valor": claves["max_velocidad_kmh"]}, headers=h)


def test_productores_crud_y_aprobacion(client, admin, db):
    h = cab(admin)
    ruta_id = db.execute("SELECT id FROM ruta WHERE nombre = 'Ruta 1 - Huata Centro'").fetchone()["id"]

    r = client.post("/productores", json={"nombre": "Productor Prueba", "documento": dni(), "ruta_id": ruta_id},
                    headers=h)
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["aprobado"] is True and p["codigo"].startswith("P-") and p["creado_por"] == int(admin["id"])

    r = client.patch(f"/productores/{p['id']}", json={"celular": celular()}, headers=h)
    assert r.status_code == 200 and r.json()["celular"] is not None

    # Alta de campo (la hace un acopiador): la base la deja sin aprobar
    acop_id = db.execute("SELECT id FROM usuario WHERE dni = '41234567'").fetchone()["id"]
    nuevo = db.execute("""
        INSERT INTO productor (nombre, ruta_id, creado_por, uuid_cliente)
        VALUES ('Alta de campo prueba', %s, %s, %s) RETURNING id, aprobado
    """, (ruta_id, acop_id, uuid.uuid4())).fetchone()
    assert nuevo["aprobado"] is False

    pendientes = client.get("/productores?pendiente=true", headers=h).json()
    assert nuevo["id"] in [x["productor_id"] for x in pendientes]

    r = client.post(f"/productores/{nuevo['id']}/aprobar", headers=h)
    assert r.status_code == 200 and r.json()["aprobado"] is True
    pendientes = client.get("/productores?pendiente=true", headers=h).json()
    assert nuevo["id"] not in [x["productor_id"] for x in pendientes]

    # Desactivar: sale del listado por defecto
    client.patch(f"/productores/{p['id']}", json={"activo": False}, headers=h)
    assert p["id"] not in [x["productor_id"] for x in client.get("/productores", headers=h).json()]
    assert p["id"] in [x["productor_id"] for x in client.get("/productores?incluir_inactivos=true", headers=h).json()]


def test_lecturas_desde_vistas(client, admin, db):
    h = cab(admin)
    resumen = client.get("/productores?tipo=de_ruta", headers=h).json()
    assert len(resumen) >= 15 and all(x["tipo"] == "de_ruta" for x in resumen)

    # El seed deja a Gregoria Calsin con sanción de precio por leche alterada
    observados = client.get("/productores/observados", headers=h).json()
    gregoria = next(o for o in observados if o["nombre"] == "Gregoria Calsin Quispe")
    assert gregoria["tipo_sancion"] == "precio" and gregoria["densidad"] == 1.024

    pid = gregoria["productor_id"]
    hist = client.get(f"/productores/{pid}/recolecciones", headers=h).json()
    assert len(hist) == 14 and any(x["estado_calidad"] == "alterado" for x in hist)

    recs = client.get("/recolecciones?limit=5", headers=h).json()
    assert len(recs) == 5
    assert recs[0]["registrada_en"] >= recs[-1]["registrada_en"]


def test_acopiadores_y_analistas(client, admin):
    h = cab(admin)
    acops = client.get("/acopiadores", headers=h).json()
    juan = next(a for a in acops if a["dni"] == "41234567")
    assert {r["nombre"] for r in juan["rutas"]} == {"Ruta 1 - Huata Centro", "Ruta 2 - Orilla del lago"}

    r = client.patch(f"/acopiadores/{juan['id']}", json={"sueldo_base_mensual": 950, "celular": "951234500"},
                     headers=h)
    assert r.status_code == 200
    assert r.json()["sueldo_base_mensual"] == 950 and r.json()["celular"] == "951234500"

    r = client.post("/analistas", json={"nombre_completo": "Analista Prueba", "dni": dni(), "celular": celular(),
                                        "pin_inicial": "2468"}, headers=h)
    assert r.status_code == 201, r.text
    analista = r.json()
    assert analista["rol"] == "analista" and analista["celular_vinculado"] is False
    assert analista["id"] in [a["id"] for a in client.get("/analistas", headers=h).json()]
    r = client.patch(f"/analistas/{analista['id']}", json={"activo": False}, headers=h)
    assert r.json()["activo"] is False

    # El código de activación es solo para usuarios móviles
    assert client.post(f"/usuarios/{admin['id']}/codigo-activacion", headers=h).status_code == 422
