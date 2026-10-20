"""Pagos: liquidación semanal de productores y pago mensual de acopiadores.

queseria_test no se recrea entre corridas: las entregas de estas pruebas caen en un día pasado al azar, así
"liquidar el periodo" no toca las de otras pruebas (que se registran hoy).
"""
import random
from datetime import date, datetime, timedelta, timezone

import pytest

from conftest import (cab, crear_acopiador, crear_productor, crear_ruta_asignada, item_recoleccion,
                      movil_con_celular, push)

HOY = date.today()


def dia_de_prueba() -> date:
    # Con precio de leche vigente (desde 2026-01-01) y lejos de hoy
    inicio = date(2026, 1, 5)
    return inicio + timedelta(days=random.randint(0, max(0, (HOY - timedelta(days=30) - inicio).days)))


@pytest.fixture(scope="module")
def equipo(client, admin):
    acop = movil_con_celular(client, admin, "acopiador")
    acop["ruta_id"] = crear_ruta_asignada(client, admin, acop["id"])
    return {"acop": acop, "dia": dia_de_prueba()}


def entregar(client, admin, equipo, productor_id: int, litros: float, revisar: bool = True) -> str:
    """Entrega del día de prueba (10:00 en Lima) y, si se pide, revisada como normal por el admin."""
    registrada = datetime.combine(equipo["dia"], datetime.min.time(), timezone.utc) + timedelta(hours=15)
    item = item_recoleccion(equipo["acop"], productor_id, litros=litros, registrada_en=registrada.isoformat())
    assert push(client, equipo["acop"], recolecciones=[item])["recolecciones"][0]["estado"] == "creado"
    if revisar:
        r = client.post(f"/recolecciones/{item['id']}/calidad", json={}, headers=cab(admin))
        assert r.status_code == 200, r.text
    return item["id"]


def periodo(equipo) -> dict:
    d = equipo["dia"].isoformat()
    return {"desde": d, "hasta": d}


# ----------------------------------------------------------------- productores
def test_por_pagar_vista_previa_y_liquidar(client, admin, equipo, db):
    h = cab(admin)
    prod = crear_productor(client, admin, equipo["acop"]["ruta_id"])
    entregar(client, admin, equipo, prod["id"], 20)
    entregar(client, admin, equipo, prod["id"], 10.5)
    sin_revisar = entregar(client, admin, equipo, prod["id"], 7, revisar=False)

    pendiente = next(p for p in client.get("/pagos/productores/pendientes", headers=h).json()
                     if p["productor_id"] == prod["id"])
    assert pendiente["litros_pagables"] == 30.5 and pendiente["monto_pagable"] == 51.85   # 30.5 L × 1.70
    assert pendiente["monto_en_espera"] == 11.9                                          # 7 L sin revisar

    previa = client.get("/pagos/productores/periodo", params=periodo(equipo), headers=h).json()
    fila = next(p for p in previa if p["productor_id"] == prod["id"])
    assert fila == {"productor_id": prod["id"], "codigo": prod["codigo"], "nombre": prod["nombre"],
                    "n_recolecciones": 2, "litros": 30.5, "monto": 51.85, "litros_con_sancion": 0}

    r = client.post("/liquidaciones/lote", json=periodo(equipo), headers=h)
    assert r.status_code == 201, r.text
    liq = next(x for x in r.json() if x["productor_id"] == prod["id"])
    assert liq["estado"] == "pendiente" and liq["n_recolecciones"] == 2 and liq["monto"] == 51.85
    assert db.execute("SELECT creada_por FROM liquidacion_productor WHERE id = %s",
                      (liq["liquidacion_id"],)).fetchone()["creada_por"] == int(admin["id"])

    # Lo no revisado no entró; ya no queda nada pagable de ese periodo
    lineas = client.get(f"/liquidaciones/{liq['liquidacion_id']}", headers=h).json()["lineas"]
    assert sorted(x["litros"] for x in lineas) == [10.5, 20] and sin_revisar not in [x["recoleccion_id"] for x in lineas]
    assert all(x["precio_litro"] == 1.7 and x["fecha"] == equipo["dia"].isoformat() for x in lineas)
    assert client.post("/liquidaciones/lote", json=periodo(equipo), headers=h).json() == []

    # Si después se revisa la que faltaba, el mismo periodo ya existe para ese productor: lo rechaza la base
    assert client.post(f"/recolecciones/{sin_revisar}/calidad", json={}, headers=h).status_code == 200
    r = client.post("/liquidaciones/lote", json=periodo(equipo), headers=h)
    assert r.status_code == 409
    assert r.json()["mensaje"] == "Ese productor ya tiene una liquidación de ese mismo periodo"


def test_pagar_eliminar_y_lo_que_protege_la_base(client, admin, equipo, db):
    h = cab(admin)
    prod = crear_productor(client, admin, equipo["acop"]["ruta_id"])
    rec = entregar(client, admin, equipo, prod["id"], 12)
    # Un día propio para este productor: no choca con el periodo de la prueba anterior
    d = (equipo["dia"] + timedelta(days=1)).isoformat()
    db.execute("UPDATE recoleccion SET registrada_en = registrada_en + interval '1 day' WHERE id = %s", (rec,))
    liq = next(x for x in client.post("/liquidaciones/lote", json={"desde": d, "hasta": d}, headers=h).json()
               if x["productor_id"] == prod["id"])
    lid = liq["liquidacion_id"]

    # Eliminar una pendiente devuelve sus recolecciones a "por pagar"
    assert client.delete(f"/liquidaciones/{lid}", headers=h).status_code == 204
    assert client.get(f"/liquidaciones/{lid}", headers=h).status_code == 404
    assert any(p["productor_id"] == prod["id"] and p["monto_pagable"] == 20.4
               for p in client.get("/pagos/productores/pendientes", headers=h).json())

    lid = next(x for x in client.post("/liquidaciones/lote", json={"desde": d, "hasta": d}, headers=h).json()
               if x["productor_id"] == prod["id"])["liquidacion_id"]
    r = client.post(f"/liquidaciones/{lid}/pagar", headers=h)
    assert r.status_code == 200 and r.json()["estado"] == "pagado" and r.json()["pagada_en"] is not None
    assert client.post(f"/liquidaciones/{lid}/pagar", headers=h).json()["mensaje"] == "La liquidación ya está pagada"
    # La base no lo impide por este camino (ver eliminar_liquidacion): lo impide el endpoint
    r = client.delete(f"/liquidaciones/{lid}", headers=h)
    assert r.status_code == 409 and r.json()["mensaje"] == "La liquidación ya está pagada y no se puede eliminar"
    assert client.get(f"/liquidaciones/{lid}", headers=h).json()["estado"] == "pagado"
    # Lo que sí protege la base: tocar el detalle de una pagada
    r = db.execute("SELECT recoleccion_id FROM liquidacion_detalle WHERE liquidacion_id = %s", (lid,)).fetchone()
    with pytest.raises(Exception, match="ya está pagada y no se puede modificar"):
        db.execute("DELETE FROM liquidacion_detalle WHERE recoleccion_id = %s", (r["recoleccion_id"],))
    pagadas = client.get(f"/liquidaciones?estado=pagado&productor_id={prod['id']}", headers=h).json()
    assert [x["liquidacion_id"] for x in pagadas] == [lid]

    # Anular una recolección liquidada: parche 001
    r = client.post(f"/recolecciones/{rec}/anular", json={"motivo": "Prueba"}, headers=h)
    assert r.status_code == 409 and "ya fue liquidada" in r.json()["mensaje"]


def test_liquidacion_vacia_inexistente_y_periodo_invertido(client, admin, equipo, db):
    h = cab(admin)
    prod = crear_productor(client, admin, equipo["acop"]["ruta_id"])
    vacia = db.execute("""
        INSERT INTO liquidacion_productor (productor_id, desde, hasta, creada_por)
        VALUES (%s, '2026-01-01', '2026-01-02', %s) RETURNING id
    """, (prod["id"], int(admin["id"]))).fetchone()["id"]
    r = client.post(f"/liquidaciones/{vacia}/pagar", headers=h)
    assert r.status_code == 409 and r.json()["mensaje"] == "No se puede pagar una liquidación sin detalle"

    assert client.post("/liquidaciones/999999999/pagar", headers=h).status_code == 404
    assert client.delete("/liquidaciones/999999999", headers=h).status_code == 404
    assert client.get("/liquidaciones/999999999", headers=h).status_code == 404
    # Periodo invertido: no hay nada pagable en él, así que no se crea nada
    assert client.post("/liquidaciones/lote", json={"desde": "2026-02-10", "hasta": "2026-02-01"},
                       headers=h).json() == []
    assert client.get("/liquidaciones?estado=otro", headers=h).status_code == 422


# ----------------------------------------------------------------- acopiadores
def test_pago_mensual_del_acopiador(client, admin, equipo, db):
    h = cab(admin)
    acop = equipo["acop"]
    mes = equipo["dia"].replace(day=1).isoformat()
    prod = crear_productor(client, admin, acop["ruta_id"])
    entregar(client, admin, equipo, prod["id"], 100)

    fila = next(a for a in client.get(f"/pagos/acopiadores?mes={mes}", headers=h).json() if a["acopiador_id"] == acop["id"])
    # Las otras pruebas de este módulo también entregaron ese mes: se compara con v_acopiador_mes
    vista = db.execute("SELECT * FROM v_acopiador_mes WHERE acopiador_id = %s AND mes = %s", (acop["id"], mes)).fetchone()
    assert fila["litros"] == float(vista["litros"]) and fila["comision_estimada"] == float(vista["comision_estimada"])
    assert fila["sueldo_estimado"] == 850 + fila["comision_estimada"] and fila["pago_id"] is None

    r = client.post("/pagos/acopiadores", json={"acopiador_id": acop["id"], "mes": mes, "ajustes": 10,
                                                "nota": "Bono"}, headers=h)
    assert r.status_code == 201, r.text
    pago = r.json()
    assert pago["estado"] == "pendiente" and pago["sueldo_base"] == 850
    assert pago["total"] == round(850 + fila["comision_estimada"] + 10, 2)

    r = client.post("/pagos/acopiadores", json={"acopiador_id": acop["id"], "mes": mes}, headers=h)
    assert r.status_code == 409 and r.json()["mensaje"] == "Ese acopiador ya tiene un pago registrado para ese mes"
    r = client.post("/pagos/acopiadores", json={"acopiador_id": acop["id"], "mes": equipo["dia"].replace(day=2).isoformat()},
                    headers=h)
    assert r.status_code == 422 and r.json()["mensaje"] == "El mes debe indicarse con su primer día (AAAA-MM-01)"
    r = client.post("/pagos/acopiadores", json={"acopiador_id": 999999999, "mes": mes}, headers=h)
    assert r.status_code == 404 and r.json()["mensaje"] == "El acopiador no existe"

    r = client.patch(f"/pagos/acopiadores/{pago['id']}", json={"ajustes": -5}, headers=h)
    assert r.status_code == 200 and r.json()["total"] == round(pago["total"] - 15, 2)

    r = client.post(f"/pagos/acopiadores/{pago['id']}/pagar", headers=h)
    assert r.status_code == 200, r.text
    pagado = r.json()
    assert pagado["estado"] == "pagado" and pagado["gasto_id"] is not None
    gasto = db.execute("""
        SELECT g.monto, g.acopiador_id, g.fecha, g.registrado_por, c.nombre AS categoria
          FROM gasto_operativo g JOIN categoria_gasto c ON c.id = g.categoria_id WHERE g.id = %s
    """, (pagado["gasto_id"],)).fetchone()
    assert gasto["categoria"] == "Sueldo acopiador" and float(gasto["monto"]) == pagado["total"]
    assert gasto["acopiador_id"] == acop["id"] and gasto["registrado_por"] == int(admin["id"])
    hoy_lima = db.execute("SELECT (now() AT TIME ZONE 'America/Lima')::date AS d").fetchone()["d"]
    assert gasto["fecha"] == hoy_lima

    for respuesta in (client.post(f"/pagos/acopiadores/{pago['id']}/pagar", headers=h),
                      client.patch(f"/pagos/acopiadores/{pago['id']}", json={"ajustes": 0}, headers=h),
                      client.delete(f"/pagos/acopiadores/{pago['id']}", headers=h)):
        assert respuesta.status_code == 409
        assert respuesta.json()["mensaje"] == "El pago ya está pagado y no se puede modificar"


def test_pago_con_total_cero_no_se_paga_y_pendiente_se_elimina(client, admin, db):
    h = cab(admin)
    acop = crear_acopiador(client, admin, sueldo_base_mensual=0, comision_por_litro=0)
    mes = HOY.replace(day=1).isoformat()
    pago = client.post("/pagos/acopiadores", json={"acopiador_id": acop["id"], "mes": mes}, headers=h).json()
    assert pago["total"] == 0

    r = client.post(f"/pagos/acopiadores/{pago['id']}/pagar", headers=h)
    assert r.status_code == 409 and r.json()["mensaje"] == "El monto del gasto debe ser mayor que cero"
    fila = db.execute("SELECT estado, gasto_id FROM pago_acopiador WHERE id = %s", (pago["id"],)).fetchone()
    assert fila["estado"] == "pendiente" and fila["gasto_id"] is None
    assert db.execute("SELECT 1 FROM gasto_operativo WHERE acopiador_id = %s", (acop["id"],)).fetchone() is None

    assert client.delete(f"/pagos/acopiadores/{pago['id']}", headers=h).status_code == 204
    assert client.delete(f"/pagos/acopiadores/{pago['id']}", headers=h).status_code == 404


def test_solo_admin(client, equipo):
    t = cab(equipo["acop"]["token"])
    assert client.get("/pagos/productores/pendientes", headers=t).status_code == 403
    assert client.post("/liquidaciones/lote", json={"desde": "2026-01-01", "hasta": "2026-01-01"},
                       headers=t).status_code == 403
    assert client.get("/pagos/acopiadores?mes=2026-01-01", headers=t).status_code == 403
    assert client.post("/pagos/acopiadores/1/pagar", headers=t).status_code == 403
