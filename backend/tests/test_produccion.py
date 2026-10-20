"""Producción y venta rápidas: GET /recetas, GET /produccion/previa, POST /produccion, GET /lotes, GET /lotes/disponibles,
GET/POST /clientes, POST/GET /ventas.

queseria_test no se recrea: cada prueba usa su propia receta e insumo (creados aquí) y leche de un día pasado al azar.
"""
import random
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from conftest import cab, crear_productor, crear_ruta_asignada, item_recoleccion, movil_con_celular, push


def receta_de_prueba(db, admin, stock: float, por_100_litros: float = 2.0) -> dict:
    """Receta (queso por unidad, 10 unidades por 100 L, 7 días de vida) con un insumo propio y su stock inicial."""
    sufijo = uuid.uuid4().hex[:8]
    insumo = db.execute("INSERT INTO insumo (nombre, unidad) VALUES (%s, 'g') RETURNING id",
                        (f"Insumo prueba {sufijo}",)).fetchone()["id"]
    if stock > 0:
        db.execute("""
            INSERT INTO movimiento_insumo (insumo_id, tipo, cantidad, costo_unitario, usuario_id)
            VALUES (%s, 'stock_inicial', %s, 0.5, %s)
        """, (insumo, stock, int(admin["id"])))
    receta = db.execute("""
        INSERT INTO receta (nombre, unidad_venta, precio_venta, litros_base, rendimiento_base, dias_vida_util)
        VALUES (%s, 'unidad', 20, 100, 10, 7) RETURNING id
    """, (f"Queso prueba {sufijo}",)).fetchone()["id"]
    db.execute("INSERT INTO receta_insumo (receta_id, insumo_id, cantidad) VALUES (%s, %s, %s)", (receta, insumo, por_100_litros))
    return {"receta_id": receta, "insumo_id": insumo}


@pytest.fixture(scope="module")
def leche(client, admin):
    """60 L de leche aprobada de un día pasado al azar (con precio vigente), registrada y revisada como normal."""
    acop = movil_con_celular(client, admin, "acopiador")
    prod = crear_productor(client, admin, crear_ruta_asignada(client, admin, acop["id"]))
    dia = date(2026, 1, 5) + timedelta(days=random.randint(0, 200))
    registrada = datetime.combine(dia, datetime.min.time(), timezone.utc) + timedelta(hours=15)
    item = item_recoleccion(acop, prod["id"], litros=60, registrada_en=registrada.isoformat())
    assert push(client, acop, recolecciones=[item])["recolecciones"][0]["estado"] == "creado"
    assert client.post(f"/recolecciones/{item['id']}/calidad", json={}, headers=cab(admin)).status_code == 200
    return {"dia": dia}


def producir(client, admin, receta: dict, dia: date, litros: float, cantidad: float, **extra):
    return client.post("/produccion", json={"receta_id": receta["receta_id"], "fecha_leche": dia.isoformat(),
                                            "litros": litros, "cantidad_producida": cantidad, **extra}, headers=cab(admin))


def test_recetas_traen_sus_insumos(client, admin, db):
    receta = receta_de_prueba(db, admin, stock=100)
    fila = next(r for r in client.get("/recetas", headers=cab(admin)).json() if r["id"] == receta["receta_id"])
    assert fila["unidad_venta"] == "unidad" and fila["rendimiento_base"] == 10 and fila["dias_vida_util"] == 7
    assert [(i["insumo_id"], i["cantidad"], i["unidad"]) for i in fila["insumos"]] == [(receta["insumo_id"], 2.0, "g")]


def test_previa_dice_que_falta_y_no_escribe(client, admin, db, leche):
    receta = receta_de_prueba(db, admin, stock=0.5)
    r = client.get("/produccion/previa", params={"receta_id": receta["receta_id"], "fecha_leche": leche["dia"].isoformat(),
                                                 "litros": 40}, headers=cab(admin))
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["leche_disponible"] >= 40 and p["rendimiento_estimado"] == 4      # 10 unidades por 100 L
    [insumo] = p["insumos"]                                                     # 2 g por 100 L → 0.8 g para 40 L
    assert insumo["insumo_id"] == receta["insumo_id"] and insumo["unidad"] == "g"
    assert insumo["necesita"] == 0.8 and insumo["hay"] == 0.5 and round(insumo["falta"], 3) == 0.3
    assert db.execute("SELECT COUNT(*) AS n FROM lote_produccion WHERE receta_id = %s",
                      (receta["receta_id"],)).fetchone()["n"] == 0
    assert client.get("/produccion/previa", params={"receta_id": receta["receta_id"], "fecha_leche": "2026-01-05",
                                                    "litros": 0}, headers=cab(admin)).status_code == 422


def test_producir_crea_lote_cerrado_con_leche_insumos_y_codigo(client, admin, db, leche):
    receta = receta_de_prueba(db, admin, stock=100)
    r = producir(client, admin, receta, leche["dia"], 10, 1.2)
    assert r.status_code == 201, r.text
    lote = r.json()
    hoy_lima = db.execute("SELECT (now() AT TIME ZONE 'America/Lima')::date AS d").fetchone()["d"]
    assert lote["estado"] == "cerrado" and lote["litros_leche"] == 10 and lote["cantidad_producida"] == 1.2
    assert lote["fecha_produccion"] == hoy_lima.isoformat() and lote["codigo"].startswith(f"L-{hoy_lima.year}-")
    assert lote["costo_insumos"] == 0.1       # 0.2 g × S/ 0.50
    stock = db.execute("SELECT stock FROM v_insumo_stock WHERE insumo_id = %s", (receta["insumo_id"],)).fetchone()["stock"]
    assert float(stock) == 99.8
    # El siguiente lote del mismo año toma el número siguiente
    otro = producir(client, admin, receta, leche["dia"], 5, 0.5).json()
    n = lambda codigo: int(codigo.rsplit("-", 1)[1])
    assert n(otro["codigo"]) == n(lote["codigo"]) + 1
    assert lote["lote_id"] in [x["lote_id"] for x in client.get("/lotes", headers=cab(admin)).json()]


def test_lo_que_rechaza_la_base_vuelve_como_409_y_no_queda_nada(client, admin, db, leche):
    sin_stock = receta_de_prueba(db, admin, stock=0.5)
    r = producir(client, admin, sin_stock, leche["dia"], 40, 4)
    assert r.status_code == 409 and r.json()["mensaje"].startswith("Stock insuficiente del insumo")
    assert db.execute("SELECT COUNT(*) AS n FROM lote_produccion WHERE receta_id = %s",
                      (sin_stock["receta_id"],)).fetchone()["n"] == 0   # todo o nada

    con_stock = receta_de_prueba(db, admin, stock=100)
    r = producir(client, admin, con_stock, date(2001, 1, 1), 10, 1)
    assert r.status_code == 409 and "Leche aprobada insuficiente" in r.json()["mensaje"]
    assert producir(client, admin, {"receta_id": 999999999}, leche["dia"], 10, 1).status_code == 404


def test_venta_al_contado_desde_lote_cerrado_con_saldo(client, admin, db, leche):
    h = cab(admin)
    receta = receta_de_prueba(db, admin, stock=100)
    lote = producir(client, admin, receta, leche["dia"], 10, 3).json()
    disponible = next(x for x in client.get("/lotes/disponibles", headers=h).json() if x["lote_id"] == lote["lote_id"])
    assert disponible["saldo"] == 3 and disponible["unidad_venta"] == "unidad" and disponible["precio_venta"] == 20

    r = client.post("/clientes", json={"nombre": f"Bodega Prueba {uuid.uuid4().hex[:6]}"}, headers=h)
    assert r.status_code == 201, r.text
    cliente = r.json()
    assert client.post("/clientes", json={"nombre": "Mal", "documento": "123"}, headers=h).json()["mensaje"] == \
        "El documento debe ser un DNI (8 dígitos) o RUC (11 dígitos)"

    r = client.post("/ventas", json={"cliente_id": cliente["id"], "lote_id": lote["lote_id"], "cantidad": 2,
                                     "precio_unitario": 19.5}, headers=h)
    assert r.status_code == 201, r.text
    venta = r.json()
    assert venta["subtotal"] == 39 and venta["cliente"] == cliente["nombre"] and venta["codigo_lote"] == lote["codigo"]
    assert next(x for x in client.get("/lotes/disponibles", headers=h).json() if x["lote_id"] == lote["lote_id"])["saldo"] == 1

    r = client.post("/ventas", json={"cliente_id": cliente["id"], "lote_id": lote["lote_id"], "cantidad": 5,
                                     "precio_unitario": 20}, headers=h)
    assert r.status_code == 409 and r.json()["mensaje"].startswith("Saldo insuficiente en el lote")
    r = client.post("/ventas", json={"cliente_id": cliente["id"], "lote_id": lote["lote_id"], "cantidad": 1,
                                     "precio_unitario": 20, "fecha": "2001-01-01"}, headers=h)
    assert r.status_code == 409 and "anterior a la producción" in r.json()["mensaje"]
    assert client.post("/ventas", json={"cliente_id": 999999999, "lote_id": lote["lote_id"], "cantidad": 1,
                                        "precio_unitario": 20}, headers=h).json()["mensaje"] == "El cliente no existe"

    hoy = venta["fecha"]
    assert venta["venta_id"] in [v["venta_id"] for v in client.get(f"/ventas?desde={hoy}&hasta={hoy}", headers=h).json()]


def test_insumos_es_la_vista_de_stock(client, admin, db):
    con = receta_de_prueba(db, admin, stock=100)
    sin = receta_de_prueba(db, admin, stock=0)
    filas = {i["insumo_id"]: i for i in client.get("/insumos", headers=cab(admin)).json()}
    vista = {v["insumo_id"]: v for v in db.execute("SELECT * FROM v_insumo_stock").fetchall()}
    assert set(filas) == set(vista)                                  # mismos insumos (los activos)
    assert filas[con["insumo_id"]]["stock"] == 100 and filas[con["insumo_id"]]["estado"] == "disponible"
    assert filas[con["insumo_id"]]["costo_unitario"] == 0.5 and filas[con["insumo_id"]]["unidad"] == "g"
    assert filas[con["insumo_id"]]["ultima_actualizacion"] is not None
    assert filas[sin["insumo_id"]]["stock"] == 0 and filas[sin["insumo_id"]]["estado"] == "sin_stock"
    assert filas[sin["insumo_id"]]["ultima_actualizacion"] is None


def test_crear_insumo_y_registrar_compra(client, admin, db):
    h = cab(admin)
    nombre = f"Cultivo prueba {uuid.uuid4().hex[:6]}"
    r = client.post("/insumos", json={"nombre": nombre, "unidad": "g"}, headers=h)
    assert r.status_code == 201, r.text
    nuevo = r.json()
    assert nuevo["stock"] == 0 and nuevo["estado"] == "sin_stock" and nuevo["costo_unitario"] == 0
    r = client.post("/insumos", json={"nombre": nombre, "unidad": "g"}, headers=h)
    assert r.status_code == 409 and r.json()["mensaje"] == "Ya existe un insumo con ese nombre"

    # Primer ingreso: fija el costo; el segundo lo promedia (lo hace fn_movimiento_insumo)
    r = client.post(f"/insumos/{nuevo['insumo_id']}/ingresos", json={"cantidad": 100, "costo_unitario": 0.5}, headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["insumo"]["stock"] == 100 and r.json()["insumo"]["costo_unitario"] == 0.5
    r = client.post(f"/insumos/{nuevo['insumo_id']}/ingresos", json={"cantidad": 50, "costo_unitario": 0.8, "nota": "Factura 12"},
                    headers=h)
    insumo = r.json()["insumo"]
    assert insumo["stock"] == 150 and insumo["costo_unitario"] == 0.6 and insumo["estado"] == "disponible"
    mov = db.execute("SELECT tipo, usuario_id, nota, fecha FROM movimiento_insumo WHERE id = %s",
                     (r.json()["movimiento_id"],)).fetchone()
    assert mov["tipo"] == "ingreso" and mov["usuario_id"] == int(admin["id"]) and mov["nota"] == "Factura 12"


def test_compra_con_fecha_cuenta_en_el_flujo_de_su_mes_y_no_en_el_resultado(client, admin, db):
    h = cab(admin)
    insumo = client.post("/insumos", json={"nombre": f"Sal prueba {uuid.uuid4().hex[:6]}", "unidad": "kg"}, headers=h).json()
    antes = client.get("/dashboard?mes=2001-03-01", headers=h).json()
    r = client.post(f"/insumos/{insumo['insumo_id']}/ingresos", json={"cantidad": 20, "costo_unitario": 1.5, "fecha": "2001-03-10"},
                    headers=h)
    assert r.status_code == 201, r.text
    fecha_lima = db.execute("SELECT (fecha AT TIME ZONE 'America/Lima') AS f FROM movimiento_insumo WHERE id = %s",
                            (r.json()["movimiento_id"],)).fetchone()["f"]
    assert fecha_lima.date().isoformat() == "2001-03-10" and fecha_lima.hour == 12
    despues = client.get("/dashboard?mes=2001-03-01", headers=h).json()
    assert round(despues["flujo"]["egreso_insumos"] - antes["flujo"]["egreso_insumos"], 2) == 30
    # El inventario sin vender no es gasto (v_resultado_mensual): el resultado no cambia
    assert despues["resultado"]["utilidad_neta"] == antes["resultado"]["utilidad_neta"]


def test_lo_que_rechaza_la_base_al_comprar_vuelve_como_409(client, admin):
    h = cab(admin)
    insumo = client.post("/insumos", json={"nombre": f"Envase prueba {uuid.uuid4().hex[:6]}", "unidad": "unidad"}, headers=h).json()
    url = f"/insumos/{insumo['insumo_id']}/ingresos"
    r = client.post(url, json={"cantidad": 0, "costo_unitario": 1}, headers=h)
    assert r.status_code == 409 and r.json()["mensaje"] == "La cantidad de un ingreso debe ser mayor que cero"
    r = client.post(url, json={"cantidad": 5, "costo_unitario": 0}, headers=h)
    assert r.status_code == 409 and r.json()["mensaje"] == "Un ingreso necesita un costo unitario mayor que cero"
    r = client.post(url, json={"cantidad": 5, "costo_unitario": -1}, headers=h)
    assert r.status_code == 409 and r.json()["mensaje"] == "El costo unitario no puede ser negativo"
    assert client.post("/insumos/999999999/ingresos", json={"cantidad": 5, "costo_unitario": 1}, headers=h).status_code == 404
    assert client.post("/insumos", json={"nombre": "X", "unidad": "litros"}, headers=h).status_code == 422


def test_solo_admin(client, admin):
    t = cab(movil_con_celular(client, admin, "acopiador")["token"])
    for metodo, ruta in [("get", "/recetas"), ("get", "/insumos"), ("get", "/lotes"), ("get", "/lotes/disponibles"), ("get", "/clientes")]:
        assert getattr(client, metodo)(ruta, headers=t).status_code == 403
    assert client.post("/produccion", json={}, headers=t).status_code == 403
    assert client.post("/insumos", json={}, headers=t).status_code == 403
    assert client.post("/insumos/1/ingresos", json={}, headers=t).status_code == 403
    assert client.post("/ventas", json={}, headers=t).status_code == 403
