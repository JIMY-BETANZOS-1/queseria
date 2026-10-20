"""GET /dashboard y GET /jornadas: lo que devuelven es lo que dicen las vistas de la base (sin cálculos propios)."""
from datetime import date

from conftest import cab, crear_acopiador, crear_productor, crear_ruta_asignada, item_recoleccion, movil_con_celular, push


def _num(valor) -> float:
    return float(valor or 0)


def test_dashboard_coincide_con_las_vistas(client, admin, db):
    h = cab(admin)
    # Una entrega de hoy, para que el mes actual tenga leche
    acop = movil_con_celular(client, admin, "acopiador")
    prod = crear_productor(client, admin, crear_ruta_asignada(client, admin, acop["id"]))
    assert push(client, acop, recolecciones=[item_recoleccion(acop, prod["id"])])["recolecciones"][0]["estado"] == "creado"
    # Un alta de campo sin aprobar pero desactivada: no debe contar entre las altas por aprobar
    db.execute("""
        INSERT INTO productor (nombre, ruta_id, creado_por, uuid_cliente, activo)
        VALUES ('Alta inactiva dashboard', %s, %s, gen_random_uuid(), false)
    """, (prod["ruta_id"], acop["id"]))

    hoy = db.execute("SELECT (now() AT TIME ZONE 'America/Lima')::date AS d").fetchone()["d"]
    # Un pago de acopiador pendiente del mes (S/ 500): no debe sumar como pagado
    otro = crear_acopiador(client, admin, sueldo_base_mensual=500, comision_por_litro=0)
    r = client.post("/pagos/acopiadores", json={"acopiador_id": otro["id"], "mes": hoy.replace(day=1).isoformat()}, headers=h)
    assert r.status_code == 201 and r.json()["total"] == 500
    r = client.get(f"/dashboard?mes={hoy.isoformat()}", headers=h)   # cualquier día del mes vale
    assert r.status_code == 200, r.text
    d = r.json()
    mes = hoy.replace(day=1)
    assert d["mes"] == mes.isoformat()

    leche = db.execute("""
        SELECT SUM(litros_recolectados) AS rec, SUM(litros_aprobados) AS apr, SUM(litros_por_revisar) AS rev
          FROM v_leche_jornada WHERE date_trunc('month', fecha::timestamp)::date = %s
    """, (mes,)).fetchone()
    assert d["leche"]["litros_recolectados"] == _num(leche["rec"]) > 0
    assert d["leche"]["litros_aprobados"] == _num(leche["apr"])
    assert d["leche"]["litros_por_revisar"] == _num(leche["rev"])

    flujo = db.execute("SELECT * FROM v_flujo_mensual WHERE mes = %s", (mes,)).fetchone()
    assert d["flujo"]["egreso_leche"] == _num(flujo["egreso_leche"]) and d["flujo"]["saldo_caja"] == _num(flujo["saldo_caja"])
    resultado = db.execute("SELECT * FROM v_resultado_mensual WHERE mes = %s", (mes,)).fetchone()
    assert d["resultado"]["utilidad_neta"] == _num(resultado["utilidad_neta"] if resultado else 0)

    pp = db.execute("SELECT SUM(monto_pagable) AS p, SUM(monto_en_espera) AS e FROM v_pago_pendiente_productor").fetchone()
    assert d["por_pagar"]["monto_pagable"] == _num(pp["p"]) and d["por_pagar"]["monto_en_espera"] == _num(pp["e"])
    liq = db.execute("SELECT COUNT(*) AS n FROM liquidacion_productor WHERE estado = 'pendiente'").fetchone()
    assert d["por_pagar"]["liquidaciones_pendientes"] == liq["n"]

    est = db.execute("SELECT SUM(sueldo_estimado) AS s FROM v_acopiador_mes WHERE mes = %s", (mes,)).fetchone()
    assert d["acopiadores"]["sueldo_estimado"] == _num(est["s"])
    pagos = db.execute("""
        SELECT SUM(total) FILTER (WHERE estado = 'pagado') AS pagado, COUNT(*) FILTER (WHERE estado = 'pendiente') AS pend
          FROM pago_acopiador WHERE mes = %s
    """, (mes,)).fetchone()
    assert d["acopiadores"]["pagado"] == _num(pagos["pagado"]) and d["acopiadores"]["pagos_pendientes"] == pagos["pend"]

    at = d["atencion"]
    assert at["entregas_sin_revisar"] == db.execute("SELECT COUNT(*) AS n FROM v_recoleccion_sin_revisar").fetchone()["n"] >= 1
    assert at["alertas_pendientes"] == db.execute(
        "SELECT COUNT(*) AS n FROM alerta_recoleccion WHERE revisada_en IS NULL").fetchone()["n"]
    assert at["altas_por_aprobar"] == db.execute(
        "SELECT COUNT(*) AS n FROM productor WHERE NOT aprobado AND activo").fetchone()["n"]
    assert at["productores_observados"] == db.execute(
        "SELECT COUNT(DISTINCT productor_id) AS n FROM v_productor_observado").fetchone()["n"]


def test_dashboard_de_un_mes_sin_movimientos_da_ceros(client, admin):
    d = client.get("/dashboard?mes=2001-02-15", headers=cab(admin)).json()
    assert d["mes"] == "2001-02-01"
    assert d["leche"]["litros_recolectados"] == 0 and d["flujo"]["saldo_caja"] == 0
    assert d["resultado"]["utilidad_neta"] == 0 and d["acopiadores"]["sueldo_estimado"] == 0


def test_jornadas(client, admin, db):
    h = cab(admin)
    hoy = db.execute("SELECT (now() AT TIME ZONE 'America/Lima')::date AS d").fetchone()["d"]
    desde = date.fromordinal(hoy.toordinal() - 13)
    filas = client.get(f"/jornadas?desde={desde}&hasta={hoy}", headers=h).json()
    vista = db.execute("SELECT fecha, litros_recolectados FROM v_leche_jornada WHERE fecha BETWEEN %s AND %s ORDER BY fecha",
                       (desde, hoy)).fetchall()
    assert [(f["fecha"], f["litros_recolectados"]) for f in filas] == [(v["fecha"].isoformat(), float(v["litros_recolectados"]))
                                                                      for v in vista]
    r = client.get(f"/jornadas?desde={hoy}&hasta={desde}", headers=h)
    assert r.status_code == 422 and r.json()["mensaje"] == "La fecha final no puede ser anterior a la inicial"
    assert client.get("/jornadas?desde=2020-01-01&hasta=2026-01-01", headers=h).status_code == 422


def test_solo_admin(client, admin):
    acop = movil_con_celular(client, admin, "acopiador")
    assert client.get("/dashboard?mes=2026-10-01", headers=cab(acop["token"])).status_code == 403
    assert client.get("/jornadas?desde=2026-10-01&hasta=2026-10-02", headers=cab(acop["token"])).status_code == 403
