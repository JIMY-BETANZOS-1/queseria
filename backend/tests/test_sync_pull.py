"""GET /sync/pull, GET /acopiador/mi-dia, GET /acopiador/ultimos-dias y las acciones del admin (alertas y anulación)."""
import uuid
from datetime import datetime, time, timedelta, timezone

from conftest import cab, crear_productor, crear_ruta_asignada, item_recoleccion, movil_con_celular, push


def pull(client, movil, desde=None) -> dict:
    r = client.get("/sync/pull", params={"desde": desde} if desde else None, headers=cab(movil["token"]))
    assert r.status_code == 200, r.text
    return r.json()


def test_pull_acopiador_incremental(client, admin, db):
    acop = movil_con_celular(client, admin, "acopiador")
    ruta_id = crear_ruta_asignada(client, admin, acop["id"])
    p1 = crear_productor(client, admin, ruta_id)
    p2 = crear_productor(client, admin, ruta_id)
    db.execute("INSERT INTO sancion_productor (productor_id, tipo, desde, hasta) "
               "VALUES (%s, 'precio', current_date, current_date + 3)", (p2["id"],))

    completo = pull(client, acop)
    assert completo["rol"] == "acopiador"
    assert [r["id"] for r in completo["rutas"]] == [ruta_id] == completo["ruta_ids_vigentes"]
    assert {p["id"] for p in completo["productores"]} == {p1["id"], p2["id"]}
    assert set(completo["productor_ids_vigentes"]) == {p1["id"], p2["id"]}
    assert completo["estados"] == [{"productor_id": p2["id"], "sancionado": True, "bloqueado": False,
                                    "sancion_hasta": completo["estados"][0]["sancion_hasta"]}]
    assert completo["precios"]["normal"] is not None and completo["precios"]["sancion"] is not None

    # Sin cambios desde la hora del servidor: nada nuevo, pero estados e ids vigentes van completos
    desde = completo["servidor_ahora"]
    vacio = pull(client, acop, desde)
    assert vacio["rutas"] == [] and vacio["productores"] == []
    assert set(vacio["productor_ids_vigentes"]) == {p1["id"], p2["id"]}
    assert [e["productor_id"] for e in vacio["estados"]] == [p2["id"]]

    # Un productor editado y uno nuevo llegan en el siguiente pull
    assert client.patch(f"/productores/{p1['id']}", json={"celular": "987654321"}, headers=cab(admin)).status_code == 200
    p3 = crear_productor(client, admin, ruta_id)
    cambios = pull(client, acop, desde)
    assert {p["id"] for p in cambios["productores"]} == {p1["id"], p3["id"]}

    # Al reasignar la ruta deja de estar vigente para este acopiador
    otro = movil_con_celular(client, admin, "acopiador")
    assert client.put(f"/rutas/{ruta_id}/acopiador", json={"acopiador_id": otro["id"]},
                      headers=cab(admin)).status_code == 200
    despues = pull(client, acop, desde)
    assert despues["ruta_ids_vigentes"] == [] and despues["productor_ids_vigentes"] == []
    # ...y el nuevo acopiador recibe todos los productores de la ruta aunque no hayan cambiado
    nuevo = pull(client, otro, cambios["servidor_ahora"])
    assert {p["id"] for p in nuevo["productores"]} == {p1["id"], p2["id"], p3["id"]}


def test_pull_analista(client, admin):
    acop = movil_con_celular(client, admin, "acopiador")
    ruta_id = crear_ruta_asignada(client, admin, acop["id"])
    prod = crear_productor(client, admin, ruta_id)
    item = item_recoleccion(acop, prod["id"])
    push(client, acop, recolecciones=[item])
    analista = movil_con_celular(client, admin, "analista")
    externo = crear_productor(client, admin)

    datos = pull(client, analista)
    assert datos["rol"] == "analista"
    assert item["id"] in {r["recoleccion_id"] for r in datos["sin_revisar"]}
    assert item["id"] in {r["id"] for r in datos["recolecciones_hoy"]}
    assert externo["id"] in {p["id"] for p in datos["productores"]}
    assert externo["id"] in datos["productor_ids_vigentes"]
    assert all(p["tipo"] == "externo" for p in datos["productores"])

    # Revisada: sale de la lista de trabajo y vuelve a llegar (cambiada) en recolecciones_hoy
    desde = datos["servidor_ahora"]
    r = client.post("/sync/calidad", json={"revisiones": [{"recoleccion_id": item["id"]}]},
                    headers=cab(analista["token"]))
    assert r.json()["revisiones"][0]["estado"] == "creado"
    despues = pull(client, analista, desde)
    assert item["id"] not in {r["recoleccion_id"] for r in despues["sin_revisar"]}
    hoy = {r["id"]: r for r in despues["recolecciones_hoy"]}
    assert hoy[item["id"]]["revisada"] is True
    assert externo["id"] not in {p["id"] for p in despues["productores"]}


def test_mi_dia_y_anulacion(client, admin):
    acop = movil_con_celular(client, admin, "acopiador")
    ruta_id = crear_ruta_asignada(client, admin, acop["id"])
    prod = crear_productor(client, admin, ruta_id)
    a = item_recoleccion(acop, prod["id"], litros=20.5)
    b = item_recoleccion(acop, prod["id"], litros=14.25)
    push(client, acop, recolecciones=[a, b])

    r = client.get("/acopiador/mi-dia", headers=cab(acop["token"]))
    assert r.status_code == 200, r.text
    dia = r.json()
    assert dia["n_recolecciones"] == 2 and dia["total_litros"] == 34.75
    assert {x["recoleccion_id"] for x in dia["recolecciones"]} == {a["id"], b["id"]}

    r = client.post(f"/recolecciones/{a['id']}/anular", json={"motivo": "Registrada dos veces"}, headers=cab(admin))
    assert r.status_code == 200 and r.json()["anulada_en"] is not None
    r = client.post(f"/recolecciones/{a['id']}/anular", json={"motivo": "otra vez"}, headers=cab(admin))
    assert r.status_code == 409 and r.json()["mensaje"] == "La recolección ya está anulada"
    assert client.post(f"/recolecciones/{uuid.uuid4()}/anular", json={"motivo": "x"},
                       headers=cab(admin)).status_code == 404
    assert client.post(f"/recolecciones/{b['id']}/anular", json={"motivo": "x"},
                       headers=cab(acop["token"])).status_code == 403

    dia = client.get("/acopiador/mi-dia", headers=cab(acop["token"])).json()
    assert dia["n_recolecciones"] == 1 and dia["total_litros"] == 14.25
    assert len(dia["recolecciones"]) == 2            # la anulada se muestra marcada

    analista = movil_con_celular(client, admin, "analista")
    assert client.get("/acopiador/mi-dia", headers=cab(analista["token"])).status_code == 403


def test_ultimos_dias(client, admin):
    lima = timezone(timedelta(hours=-5))  # America/Lima no tiene horario de verano (y Windows no trae tzdata)
    hoy = datetime.now(lima).date()

    def a_las(dia, hora, minuto=0) -> str:
        return datetime.combine(dia, time(hora, minuto), lima).isoformat()

    acop = movil_con_celular(client, admin, "acopiador")
    ruta_id = crear_ruta_asignada(client, admin, acop["id"])
    prod = crear_productor(client, admin, ruta_id)
    ayer = hoy - timedelta(days=1)
    h1 = item_recoleccion(acop, prod["id"], litros=20.5)
    h2 = item_recoleccion(acop, prod["id"], litros=3)
    a1 = item_recoleccion(acop, prod["id"], litros=10, registrada_en=a_las(ayer, 7))
    a2 = item_recoleccion(acop, prod["id"], litros=4.25, registrada_en=a_las(ayer, 23, 30))  # 04:30 UTC de hoy
    viejo = item_recoleccion(acop, prod["id"], litros=9, registrada_en=a_las(hoy - timedelta(days=7), 7))
    push(client, acop, recolecciones=[h1, h2, a1, a2, viejo])
    assert client.post(f"/recolecciones/{h2['id']}/anular", json={"motivo": "Prueba"}, headers=cab(admin)).status_code == 200

    # Otro acopiador de la misma ruta (reasignada): lo suyo no aparece en el historial del primero
    otro = movil_con_celular(client, admin, "acopiador")
    push(client, otro, recolecciones=[item_recoleccion(otro, prod["id"], litros=50)])

    r = client.get("/acopiador/ultimos-dias", headers=cab(acop["token"]))
    assert r.status_code == 200, r.text
    dias = r.json()
    assert [d["fecha"] for d in dias] == [(hoy - timedelta(days=i)).isoformat() for i in range(7)]

    assert dias[0]["n_recolecciones"] == 1 and dias[0]["total_litros"] == 20.5
    assert {x["recoleccion_id"] for x in dias[0]["recolecciones"]} == {h1["id"], h2["id"]}  # la anulada se ve
    assert dias[1]["n_recolecciones"] == 2 and dias[1]["total_litros"] == 14.25            # 23:30 de Lima = ayer
    assert [x["recoleccion_id"] for x in dias[1]["recolecciones"]] == [a1["id"], a2["id"]]
    assert all(d["n_recolecciones"] == 0 and d["total_litros"] == 0 and d["recolecciones"] == [] for d in dias[2:])
    assert viejo["id"] not in {x["recoleccion_id"] for d in dias for x in d["recolecciones"]}

    # Hoy coincide con "Mi día"
    dia = client.get("/acopiador/mi-dia", headers=cab(acop["token"])).json()
    assert dia == dias[0]

    analista = movil_con_celular(client, admin, "analista")
    assert client.get("/acopiador/ultimos-dias", headers=cab(analista["token"])).status_code == 403
    assert client.get("/acopiador/ultimos-dias").status_code == 401


def test_revisar_alerta_libera_el_pago(client, admin, db):
    acop = movil_con_celular(client, admin, "acopiador")
    ruta_id = crear_ruta_asignada(client, admin, acop["id"])
    prod = crear_productor(client, admin, ruta_id)
    db.execute("INSERT INTO sancion_productor (productor_id, tipo, desde, hasta) "
               "VALUES (%s, 'bloqueo', current_date, current_date + 6)", (prod["id"],))
    item = item_recoleccion(acop, prod["id"])
    push(client, acop, recolecciones=[item])
    analista = movil_con_celular(client, admin, "analista")
    client.post("/sync/calidad", json={"revisiones": [{"recoleccion_id": item["id"]}]}, headers=cab(analista["token"]))

    def pago():
        return db.execute("SELECT retenida, pagable FROM v_recoleccion_pago WHERE recoleccion_id = %s",
                          (item["id"],)).fetchone()
    assert pago() == {"retenida": True, "pagable": False}

    r = client.get("/alertas", params={"recoleccion_id": item["id"]}, headers=cab(admin))
    assert r.status_code == 200
    alerta = next(a for a in r.json() if a["tipo"] == "productor_bloqueado")
    assert alerta["recoleccion_retenida"] is True and alerta["revisada_en"] is None
    assert alerta["productor"] == prod["nombre"]

    r = client.post(f"/alertas/{alerta['id']}/revisar", json={"resolucion": "Se pagará: entregó antes del aviso"},
                    headers=cab(admin))
    assert r.status_code == 200, r.text
    assert r.json()["revisada_por"] == int(admin["id"]) and r.json()["recoleccion_retenida"] is False
    assert pago() == {"retenida": False, "pagable": True}

    pendientes = client.get("/alertas", headers=cab(admin)).json()
    assert alerta["id"] not in {a["id"] for a in pendientes}
    todas = client.get("/alertas", params={"todas": True, "recoleccion_id": item["id"]}, headers=cab(admin)).json()
    assert alerta["id"] in {a["id"] for a in todas}

    r = client.post(f"/alertas/{alerta['id']}/revisar", json={"resolucion": "x"}, headers=cab(admin))
    assert r.status_code == 409
    assert client.post("/alertas/999999999/revisar", json={"resolucion": "x"}, headers=cab(admin)).status_code == 404
    assert client.get("/alertas", headers=cab(acop["token"])).status_code == 403
