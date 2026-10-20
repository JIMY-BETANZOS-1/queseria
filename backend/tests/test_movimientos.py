"""Movimientos del mes: GET /movimientos (solo lectura).

queseria_test no se recrea: la prueba crea en el mes actual (Lima) un movimiento de cada tipo y los busca por sus
nombres únicos; la conciliación con v_flujo_mensual y v_resultado_mensual se hace sobre TODO el mes, así que no
depende de lo que hayan dejado otras pruebas. El mes es el actual porque el pago del sueldo y el de la liquidación
se fechan hoy.
"""
import uuid
from datetime import date, timedelta

import pytest

from conftest import cab, crear_acopiador, crear_productor, crear_ruta_asignada, item_recoleccion, movil_con_celular, push
from test_produccion import receta_de_prueba


def hoy_lima(db) -> date:
    return db.execute("SELECT (now() AT TIME ZONE 'America/Lima')::date AS d").fetchone()["d"]


def suma(filas, tipo, columna) -> float:
    return round(sum(f[columna] for f in filas if f["tipo"] == tipo), 2)


@pytest.fixture(scope="module")
def mes_mezclado(client, admin, db):
    """En el mes actual: venta, baja, costo de lote, compra, gasto, sueldo pagado, merma y liquidación pagada."""
    h = cab(admin)
    sufijo = uuid.uuid4().hex[:6]
    hoy = hoy_lima(db)

    # Leche de hoy, aprobada (sin registrada_en: el celular la fecha ahora)
    acop = movil_con_celular(client, admin, "acopiador")
    prod = crear_productor(client, admin, crear_ruta_asignada(client, admin, acop["id"]))
    items = [item_recoleccion(acop, prod["id"], litros=40), item_recoleccion(acop, prod["id"], litros=20)]
    push(client, acop, recolecciones=items)
    for it in items:
        assert client.post(f"/recolecciones/{it['id']}/calidad", json={}, headers=h).status_code == 200

    # Lote cerrado de 20 L → 5 unidades; venta de 2 y baja de 1
    receta = receta_de_prueba(db, admin, stock=100)
    lote = client.post("/produccion", json={"receta_id": receta["receta_id"], "fecha_leche": hoy.isoformat(), "litros": 20,
                                            "cantidad_producida": 5}, headers=h).json()
    cliente = client.post("/clientes", json={"nombre": f"Bodega Mov {sufijo}"}, headers=h).json()
    r = client.post("/ventas", json={"cliente_id": cliente["id"], "lote_id": lote["lote_id"], "cantidad": 2,
                                     "precio_unitario": 19.5}, headers=h)
    assert r.status_code == 201, r.text
    db.execute("""
        INSERT INTO baja_producto (lote_id, cantidad, motivo, fecha, nota, registrado_por)
        VALUES (%s, 1, 'vencido', %s, %s, %s)
    """, (lote["lote_id"], hoy, f"Baja mov {sufijo}", int(admin["id"])))

    # Costo de un lote en proceso (la base no deja cambiar costos de un lote cerrado)
    lote_abierto = db.execute("""
        INSERT INTO lote_produccion (codigo, receta_id, fecha_produccion, creado_por)
        VALUES (%s, %s, %s, %s) RETURNING id, codigo
    """, (f"PRUEBA-MOV-{sufijo}", receta["receta_id"], hoy, int(admin["id"]))).fetchone()
    db.execute("INSERT INTO lote_costo (lote_id, concepto, descripcion, monto) VALUES (%s, 'electricidad', 'Luz', 12.34)",
               (lote_abierto["id"],))

    # Compra de insumo hoy y otra el primer día del mes anterior (no debe salir en este mes)
    insumo = client.post("/insumos", json={"nombre": f"Insumo mov {sufijo}", "unidad": "kg"}, headers=h).json()
    url = f"/insumos/{insumo['insumo_id']}/ingresos"
    assert client.post(url, json={"cantidad": 10, "costo_unitario": 0.55}, headers=h).status_code == 201
    mes_anterior = (hoy.replace(day=1) - timedelta(days=1)).replace(day=1)
    assert client.post(url, json={"cantidad": 1, "costo_unitario": 2, "fecha": mes_anterior.isoformat()},
                       headers=h).status_code == 201

    # Gasto a mano y sueldo pagado (crea su gasto "Sueldo acopiador")
    otros = next(c for c in client.get("/categorias-gasto", headers=h).json() if c["nombre"] == "Otros")
    assert client.post("/gastos", json={"categoria_id": otros["id"], "monto": 7.5, "descripcion": f"Gasto mov {sufijo}"},
                       headers=h).status_code == 201
    acop_sueldo = crear_acopiador(client, admin, sueldo_base_mensual=300, comision_por_litro=0)
    pago = client.post("/pagos/acopiadores", json={"acopiador_id": acop_sueldo["id"], "mes": "2026-01-01"}, headers=h).json()
    assert client.post(f"/pagos/acopiadores/{pago['id']}/pagar", headers=h).status_code == 200

    # Merma de leche de hoy
    merma = client.post("/mermas", json={"fecha": hoy.isoformat(), "litros": 5, "motivo": f"Derrame mov {sufijo}"}, headers=h)
    assert merma.status_code == 201, merma.text

    # Liquidación de leche del mes anterior (otro productor; no liquida la de otras pruebas), pagada HOY: el pago
    # real va en este mes aunque su periodo sea del anterior. Primero pendiente, luego pagada.
    prod_liq = crear_productor(client, admin, crear_ruta_asignada(client, admin, acop["id"]))
    dia_liq = mes_anterior + timedelta(days=9)
    vieja = item_recoleccion(acop, prod_liq["id"], litros=15, registrada_en=f"{dia_liq.isoformat()}T15:00:00+00:00")
    push(client, acop, recolecciones=[vieja])
    assert client.post(f"/recolecciones/{vieja['id']}/calidad", json={}, headers=h).status_code == 200
    liq = db.execute("""
        INSERT INTO liquidacion_productor (productor_id, desde, hasta, creada_por) VALUES (%s, %s, %s, %s) RETURNING id
    """, (prod_liq["id"], dia_liq, dia_liq, int(admin["id"]))).fetchone()["id"]
    db.execute("""
        INSERT INTO liquidacion_detalle (recoleccion_id, liquidacion_id, litros, precio_litro, con_sancion, monto)
        SELECT recoleccion_id, %s, litros, precio_litro, con_sancion, monto FROM v_recoleccion_pago
         WHERE productor_id = %s AND pagable AND NOT liquidada
    """, (liq, prod_liq["id"]))
    pendientes = client.get(f"/movimientos?mes={hoy}&tipo=pago_productor", headers=h).json()
    assert client.post(f"/liquidaciones/{liq}/pagar", headers=h).status_code == 200

    return {"hoy": hoy, "mes_anterior": mes_anterior, "sufijo": sufijo, "lote": lote, "lote_abierto": lote_abierto,
            "insumo": insumo, "acop_sueldo": acop_sueldo, "prod": prod_liq, "liq": liq, "pendientes": pendientes,
            "merma": merma.json()}


def test_un_movimiento_de_cada_tipo_en_su_columna(client, admin, db, mes_mezclado):
    m = mes_mezclado
    filas = client.get(f"/movimientos?mes={m['hoy']}", headers=cab(admin)).json()
    s = m["sufijo"]

    def una(condicion):
        encontradas = [f for f in filas if condicion(f)]
        assert len(encontradas) == 1, encontradas
        return encontradas[0]

    venta = una(lambda f: f["tipo"] == "venta" and f["referencia"] == m["lote"]["codigo"])
    assert (venta["ingreso"], venta["egreso"], venta["perdida"]) == (39, None, None)
    assert venta["descripcion"].startswith(f"Venta a Bodega Mov {s}: 2 de Queso prueba ")
    assert venta["descripcion"].endswith(" × S/ 19.50")

    costo_unidad = float(db.execute("SELECT costo_total / cantidad_producida AS c FROM v_lote_resumen WHERE lote_id = %s",
                                    (m["lote"]["lote_id"],)).fetchone()["c"])
    baja = una(lambda f: f["tipo"] == "baja" and f["referencia"] == m["lote"]["codigo"])
    assert baja["perdida"] == pytest.approx(round(costo_unidad, 2)) and baja["egreso"] is None and baja["ingreso"] is None

    costo = una(lambda f: f["tipo"] == "costo_lote" and f["referencia"] == m["lote_abierto"]["codigo"])
    assert costo["egreso"] == 12.34 and costo["descripcion"] == "Costo del lote (electricidad): Luz"

    compra = una(lambda f: f["tipo"] == "compra_insumo" and f"Insumo mov {s}" in f["descripcion"])
    assert compra["egreso"] == 5.5 and compra["descripcion"] == f"Compra: Insumo mov {s} 10 kg × S/ 0.5500"

    gasto = una(lambda f: f["tipo"] == "gasto" and f"Gasto mov {s}" in f["descripcion"])
    assert gasto["egreso"] == 7.5

    # El sueldo sale una sola vez, como gasto
    nombre = m["acop_sueldo"]["nombre_completo"]
    sueldo = una(lambda f: nombre in f["descripcion"])
    assert sueldo["tipo"] == "gasto" and sueldo["egreso"] == 300 and sueldo["descripcion"].startswith("Sueldo acopiador: ")

    merma = una(lambda f: f["tipo"] == "merma" and f"Derrame mov {s}" in f["descripcion"])
    assert merma["perdida"] == m["merma"]["valor_perdida"] and merma["egreso"] is None
    assert merma["descripcion"] == f"Merma de leche: 5 L · Derrame mov {s}"

    # Pago real: aparece al pagarse la liquidación, no mientras está pendiente
    assert m["liq"] not in [f["liquidacion_id"] for f in m["pendientes"]]
    pago = una(lambda f: f["tipo"] == "pago_productor" and f["liquidacion_id"] == m["liq"])
    monto = float(db.execute("SELECT monto FROM v_liquidacion_productor WHERE liquidacion_id = %s", (m["liq"],)).fetchone()["monto"])
    assert pago["egreso"] == pytest.approx(monto) and pago["referencia"] == m["prod"]["codigo"]
    assert pago["fecha"] == m["hoy"].isoformat()
    assert pago["descripcion"].endswith(f"(del {(m['mes_anterior'] + timedelta(days=9)).strftime('%d/%m/%Y')} "
                                        f"al {(m['mes_anterior'] + timedelta(days=9)).strftime('%d/%m/%Y')})")

    # Orden cronológico y solo fechas del mes; la compra del mes anterior está en su mes
    assert [f["fecha"] for f in filas] == sorted(f["fecha"] for f in filas)
    assert all(f["fecha"][:7] == m["hoy"].isoformat()[:7] for f in filas)
    anterior = client.get(f"/movimientos?mes={m['mes_anterior']}&tipo=compra_insumo", headers=cab(admin)).json()
    assert [f["egreso"] for f in anterior if f"Insumo mov {s}" in f["descripcion"]] == [2]


def test_conciliacion_del_mes_con_flujo_y_resultado(client, admin, db, mes_mezclado):
    """La suma por tipo del mes = la columna de v_flujo_mensual o v_resultado_mensual (con datos mezclados)."""
    inicio = mes_mezclado["hoy"].replace(day=1)
    filas = client.get(f"/movimientos?mes={inicio}", headers=cab(admin)).json()
    flujo = db.execute("SELECT * FROM v_flujo_mensual WHERE mes = %s", (inicio,)).fetchone()
    resultado = db.execute("SELECT * FROM v_resultado_mensual WHERE mes = %s", (inicio,)).fetchone()
    sin_aprobada = float(db.execute("""
        SELECT COALESCE(SUM(costo_pagado), 0) AS s FROM v_leche_jornada
         WHERE litros_aprobados = 0 AND date_trunc('month', fecha::timestamp)::date = %s
    """, (inicio,)).fetchone()["s"])

    def tolerancia(tipo):   # cada fila se redondea a céntimos; las vistas suman sin redondear
        return 0.005 * sum(1 for f in filas if f["tipo"] == tipo) + 0.01

    for tipo in ("venta", "compra_insumo", "costo_lote", "gasto", "merma", "baja"):
        assert any(f["tipo"] == tipo for f in filas), f"falta un movimiento de tipo {tipo}"
    assert suma(filas, "venta", "ingreso") == pytest.approx(float(flujo["ingresos"]), abs=tolerancia("venta"))
    assert suma(filas, "compra_insumo", "egreso") == pytest.approx(float(flujo["egreso_insumos"]), abs=tolerancia("compra_insumo"))
    assert suma(filas, "costo_lote", "egreso") == pytest.approx(float(flujo["egreso_lotes"]), abs=tolerancia("costo_lote"))
    assert suma(filas, "gasto", "egreso") == pytest.approx(float(flujo["egreso_operativo"]), abs=tolerancia("gasto"))
    assert suma(filas, "gasto", "egreso") == pytest.approx(float(resultado["gasto_operativo"]), abs=tolerancia("gasto"))
    assert suma(filas, "baja", "perdida") == pytest.approx(float(resultado["perdida_producto"]), abs=tolerancia("baja"))
    assert suma(filas, "merma", "perdida") == pytest.approx(float(resultado["perdida_leche"]) - sin_aprobada,
                                                             abs=tolerancia("merma"))
    # Ventas también = ingresos del resultado
    assert suma(filas, "venta", "ingreso") == pytest.approx(float(resultado["ingresos"]), abs=tolerancia("venta"))


def test_filtro_por_tipo_y_validaciones(client, admin, mes_mezclado):
    h = cab(admin)
    hoy = mes_mezclado["hoy"]
    mermas = client.get(f"/movimientos?mes={hoy}&tipo=merma", headers=h).json()
    assert mermas and all(f["tipo"] == "merma" for f in mermas)
    assert any(f"Derrame mov {mes_mezclado['sufijo']}" in f["descripcion"] for f in mermas)
    assert client.get(f"/movimientos?mes={hoy}&tipo=sueldo", headers=h).status_code == 422
    assert client.get("/movimientos", headers=h).status_code == 422
    vacio = client.get("/movimientos?mes=1990-01-15", headers=h)
    assert vacio.status_code == 200 and vacio.json() == []


def test_solo_admin(client, admin):
    t = cab(movil_con_celular(client, admin, "acopiador")["token"])
    assert client.get("/movimientos?mes=2026-01-01", headers=t).status_code == 403
