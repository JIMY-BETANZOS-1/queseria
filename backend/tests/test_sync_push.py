"""POST /sync/push: idempotencia, altas de campo, productor bloqueado, firma, roles y ubicación."""
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest

from app.esquemas.sync import RecoleccionPush
from app.firma import cadena_canonica, hash_de_firma
from conftest import (activar, cab, crear_productor, crear_ruta_asignada, generar_codigo, item_recoleccion,
                      movil_con_celular, nueva_clave, push, ruc)


@pytest.fixture(scope="module")
def acop(client, admin):
    movil = movil_con_celular(client, admin, "acopiador")
    movil["ruta_id"] = crear_ruta_asignada(client, admin, movil["id"])
    return movil


def _pago(db, recoleccion_id) -> dict:
    return db.execute("SELECT revisada, retenida, pagable FROM v_recoleccion_pago WHERE recoleccion_id = %s",
                      (recoleccion_id,)).fetchone()


def test_push_idempotente(client, admin, acop, db):
    prod = crear_productor(client, admin, acop["ruta_id"])
    item = item_recoleccion(acop, prod["id"])

    primero = push(client, acop, recolecciones=[item])["recolecciones"][0]
    assert primero["estado"] == "creado", primero
    assert "firma_invalida" not in primero["alertas"]
    segundo = push(client, acop, recolecciones=[item])["recolecciones"][0]
    assert segundo["estado"] == "duplicado"

    filas = db.execute("SELECT registrado_por, dispositivo_id, recibida_en, estado_calidad, calidad_en "
                       "FROM recoleccion WHERE id = %s", (item["id"],)).fetchall()
    assert len(filas) == 1
    fila = filas[0]
    assert fila["registrado_por"] == acop["id"]           # del token, no del cliente
    disp = db.execute("SELECT id FROM dispositivo WHERE device_uuid = %s", (acop["device_uuid"],)).fetchone()
    assert fila["dispositivo_id"] == disp["id"]
    assert abs((fila["recibida_en"] - datetime.now(timezone.utc)).total_seconds()) < 60   # hora del servidor
    assert fila["estado_calidad"] == "normal" and fila["calidad_en"] is None


def test_productor_nuevo_y_recoleccion_en_el_mismo_lote(client, acop, db):
    uuid_cliente = str(uuid.uuid4())
    productor = {"uuid_cliente": uuid_cliente, "nombre": "Juana Mamani (alta de campo)", "ruta_id": acop["ruta_id"]}
    rec = item_recoleccion(acop, productor_uuid_cliente=uuid_cliente)

    res = push(client, acop, productores=[productor], recolecciones=[rec])
    p, r = res["productores"][0], res["recolecciones"][0]
    assert p["estado"] == "creado" and p["codigo"].startswith("P-")
    assert r["estado"] == "creado", r

    fila = db.execute("SELECT tipo, aprobado, creado_por FROM productor WHERE id = %s", (p["productor_id"],)).fetchone()
    assert fila == {"tipo": "de_ruta", "aprobado": False, "creado_por": acop["id"]}   # nace sin aprobar
    assert db.execute("SELECT productor_id FROM recoleccion WHERE id = %s",
                      (rec["id"],)).fetchone()["productor_id"] == p["productor_id"]
    assert _pago(db, rec["id"])["retenida"] is True                                  # no aprobado -> retenida

    otra = push(client, acop, productores=[productor], recolecciones=[rec])
    assert otra["productores"][0]["estado"] == "duplicado"
    assert otra["productores"][0]["productor_id"] == p["productor_id"]
    assert otra["recolecciones"][0]["estado"] == "duplicado"


def test_recoleccion_de_productor_desconocido_se_rechaza_sola(client, admin, acop):
    prod = crear_productor(client, admin, acop["ruta_id"])
    res = push(client, acop, recolecciones=[item_recoleccion(acop, productor_uuid_cliente=str(uuid.uuid4())),
                                            item_recoleccion(acop, prod["id"])])
    malo, bueno = res["recolecciones"]
    assert malo["estado"] == "rechazado" and "no está registrado" in malo["motivo"]
    assert bueno["estado"] == "creado"


def test_productor_bloqueado_se_acepta_con_alerta_y_pago_retenido(client, admin, acop, db):
    prod = crear_productor(client, admin, acop["ruta_id"])
    db.execute("""
        INSERT INTO sancion_productor (productor_id, tipo, desde, hasta, motivo)
        VALUES (%s, 'bloqueo', current_date - 1, current_date + 5, 'Prueba de bloqueo')
    """, (prod["id"],))
    item = item_recoleccion(acop, prod["id"])

    r = push(client, acop, recolecciones=[item])["recolecciones"][0]
    assert r["estado"] == "creado"
    assert "productor_bloqueado" in r["alertas"]
    assert _pago(db, item["id"])["retenida"] is True


def test_firma_invalida_guarda_y_crea_alerta(client, admin, acop, db):
    prod = crear_productor(client, admin, acop["ruta_id"])
    alterada = {**item_recoleccion(acop, prod["id"], litros=20.0), "litros": 35.0}   # cambiada después de firmar
    sin_firma = item_recoleccion(acop, prod["id"], firmado=False, litros=12.0)

    res = push(client, acop, recolecciones=[alterada, sin_firma])["recolecciones"]
    for r in res:
        assert r["estado"] == "creado"
        assert "firma_invalida" in r["alertas"]
    detalles = [db.execute("SELECT detalle FROM alerta_recoleccion WHERE recoleccion_id = %s AND tipo = 'firma_invalida'",
                           (it["id"],)).fetchone()["detalle"] for it in (alterada, sin_firma)]
    assert detalles == ["La firma no coincide con los datos de la recolección", "La recolección llegó sin firma"]
    assert _pago(db, alterada["id"])["retenida"] is True


def test_cadena_de_firmas_con_hash_anterior(client, admin, acop):
    prod = crear_productor(client, admin, acop["ruta_id"])
    primera = item_recoleccion(acop, prod["id"], litros=10.0)
    segunda = item_recoleccion(acop, prod["id"], litros=11.0, hash_anterior=hash_de_firma(primera["firma"]))
    res = push(client, acop, recolecciones=[primera, segunda])["recolecciones"]
    assert [r["estado"] for r in res] == ["creado", "creado"]
    assert all("firma_invalida" not in r["alertas"] for r in res)


def _reactivar(client, admin, movil: dict, clave_publica: str, pin: str) -> dict:
    """PIN olvidado: código nuevo y reactivación del MISMO celular (mismo device_uuid)."""
    r = activar(client, generar_codigo(client, admin, movil["id"]), movil["device_uuid"], clave_publica, pin=pin)
    assert r.status_code == 200, r.text
    return {**movil, "token": r.json()["access_token"], "dispositivo_id": r.json()["dispositivo_id"]}


def test_reactivar_con_la_misma_clave_no_invalida_lo_pendiente(client, admin, db):
    """Lo firmado ANTES de reactivar (pendiente en el celular) se acepta después sin firma_invalida,
    con el mismo dispositivo_id y la cadena hash_anterior intacta: el celular reutiliza su clave."""
    movil = movil_con_celular(client, admin, "acopiador")
    ruta = crear_ruta_asignada(client, admin, movil["id"])
    prod = crear_productor(client, admin, ruta)
    disp_antes = db.execute("SELECT id FROM dispositivo WHERE device_uuid = %s", (movil["device_uuid"],)).fetchone()["id"]
    primera = item_recoleccion(movil, prod["id"], litros=10.0)
    segunda = item_recoleccion(movil, prod["id"], litros=11.0, hash_anterior=hash_de_firma(primera["firma"]))

    publica = db.execute("SELECT clave_publica FROM dispositivo WHERE id = %s", (disp_antes,)).fetchone()["clave_publica"]
    reactivado = _reactivar(client, admin, movil, publica, pin="7319")
    assert reactivado["dispositivo_id"] == disp_antes

    res = push(client, reactivado, recolecciones=[primera, segunda])["recolecciones"]
    assert [r["estado"] for r in res] == ["creado", "creado"]
    assert all("firma_invalida" not in r["alertas"] for r in res)
    filas = db.execute("SELECT dispositivo_id FROM recoleccion WHERE id IN (%s, %s)", (primera["id"], segunda["id"])).fetchall()
    assert {f["dispositivo_id"] for f in filas} == {disp_antes}


def test_reactivar_con_otra_clave_si_invalida_lo_pendiente(client, admin):
    """Por esto el celular NO reactiva con pendientes si perdió su clave de firma ("Sincronice primero"):
    el servidor verifica con la clave registrada al momento del push."""
    movil = movil_con_celular(client, admin, "acopiador")
    ruta = crear_ruta_asignada(client, admin, movil["id"])
    prod = crear_productor(client, admin, ruta)
    pendiente = item_recoleccion(movil, prod["id"], litros=10.0)

    _, otra_publica = nueva_clave()
    reactivado = _reactivar(client, admin, movil, otra_publica, pin="7319")
    r = push(client, reactivado, recolecciones=[pendiente])["recolecciones"][0]
    assert r["estado"] == "creado"            # se guarda igual (nunca se pierde leche)
    assert "firma_invalida" in r["alertas"]   # pero queda con alerta y pago retenido


def test_rol_incorrecto_se_rechaza_por_item(client, admin, acop):
    externo = crear_productor(client, admin)
    de_ruta = crear_productor(client, admin, acop["ruta_id"])
    res = push(client, acop, recolecciones=[item_recoleccion(acop, externo["id"]), item_recoleccion(acop, de_ruta["id"])])
    malo, bueno = res["recolecciones"]
    assert malo == {"indice": 0, "id": malo["id"], "estado": "rechazado",
                    "motivo": "Un acopiador solo registra productores de ruta", "alertas": []}
    assert bueno["estado"] == "creado"


def test_analista_registra_externo_pero_no_de_ruta(client, admin, acop):
    analista = movil_con_celular(client, admin, "analista")
    externo = crear_productor(client, admin)
    de_ruta = crear_productor(client, admin, acop["ruta_id"])
    res = push(client, analista, recolecciones=[item_recoleccion(analista, externo["id"], origen_ubicacion="ninguna",
                                                                 latitud=None, longitud=None, precision_m=None),
                                                item_recoleccion(analista, de_ruta["id"])])
    ok, malo = res["recolecciones"]
    assert ok["estado"] == "creado" and ok["alertas"] == []        # externos: en planta, sin alertas de GPS
    assert malo["estado"] == "rechazado" and malo["motivo"] == "El analista solo registra productores externos"

    nuevo = {"uuid_cliente": str(uuid.uuid4()), "nombre": "Externo de campo", "documento": ruc(),
             "celular": "951234567"}
    p = push(client, analista, productores=[nuevo])["productores"][0]
    assert p["estado"] == "creado"
    r = client.get(f"/productores/{p['productor_id']}", headers=cab(admin)).json()
    assert (r["tipo"], r["aprobado"]) == ("externo", True)


def test_entrega_sin_senal_se_acepta_aunque_la_ruta_se_reasigne_antes_de_sincronizar(client, admin):
    """La app nunca impide el registro (CLAUDE.md): lo que el acopiador registró sin señal entra aunque, antes de
    sincronizar, el admin le haya pasado la ruta a otro (p. ej. una cobertura). La API no revisa la asignación."""
    acop = movil_con_celular(client, admin, "acopiador")
    ruta_id = crear_ruta_asignada(client, admin, acop["id"])
    prod = crear_productor(client, admin, ruta_id)
    item = item_recoleccion(acop, prod["id"])                  # registrada sin señal, aún no subida
    alta = {"uuid_cliente": str(uuid.uuid4()), "nombre": "Alta antes de la reasignación", "ruta_id": ruta_id}
    otro = movil_con_celular(client, admin, "acopiador")
    assert client.put(f"/rutas/{ruta_id}/acopiador", json={"acopiador_id": otro["id"]},
                      headers=cab(admin)).status_code == 200

    r = push(client, acop, productores=[alta], recolecciones=[item])
    assert r["productores"][0]["estado"] == "creado"
    assert r["recolecciones"][0]["estado"] == "creado" and r["recolecciones"][0].get("motivo") is None


def test_sin_gps_se_acepta_con_alerta(client, admin, acop, db):
    prod = crear_productor(client, admin, acop["ruta_id"])
    sin_gps = item_recoleccion(acop, prod["id"], latitud=None, longitud=None, precision_m=None, origen_ubicacion=None)
    incoherente = item_recoleccion(acop, prod["id"], litros=44.0, origen_ubicacion="ninguna")   # trae coordenadas
    media = item_recoleccion(acop, prod["id"], litros=45.0, latitud=-15.6, longitud=None)

    r1, r2, r3 = push(client, acop, recolecciones=[sin_gps, incoherente, media])["recolecciones"]
    assert r1["estado"] == "creado" and "sin_ubicacion" in r1["alertas"]
    assert r2["estado"] == "creado" and "ubicacion_imprecisa" in r2["alertas"]
    assert r3["estado"] == "creado" and "sin_ubicacion" in r3["alertas"]
    for r in (r1, r2, r3):
        assert "firma_invalida" not in r["alertas"]      # se firma lo que mandó el celular, antes de normalizar

    orig = {f["id"]: f["origen_ubicacion"] for f in db.execute(
        "SELECT id::text, origen_ubicacion::text FROM recoleccion WHERE id = ANY(%s)",
        ([sin_gps["id"], incoherente["id"], media["id"]],)).fetchall()}
    assert orig == {sin_gps["id"]: "ninguna", incoherente["id"]: "ultima_conocida", media["id"]: "ninguna"}


def test_item_mal_formado_no_tumba_el_lote(client, admin, acop):
    prod = crear_productor(client, admin, acop["ruta_id"])
    malo = item_recoleccion(acop, prod["id"], firmado=False)
    del malo["litros"]
    res = push(client, acop, recolecciones=[malo, "no soy un objeto", item_recoleccion(acop, prod["id"])],
               productores=[{"nombre": "Sin uuid"}])
    r1, r2, r3 = res["recolecciones"]
    assert r1["estado"] == "rechazado" and "litros: Campo obligatorio" in r1["motivo"]
    assert r2["estado"] == "rechazado"
    assert r3["estado"] == "creado"
    assert res["productores"][0]["estado"] == "rechazado"
    assert "uuid_cliente: Campo obligatorio" in res["productores"][0]["motivo"]


def test_id_de_otro_usuario_se_rechaza(client, admin, acop):
    prod = crear_productor(client, admin, acop["ruta_id"])
    item = item_recoleccion(acop, prod["id"])
    assert push(client, acop, recolecciones=[item])["recolecciones"][0]["estado"] == "creado"
    otro = movil_con_celular(client, admin, "acopiador")
    r = push(client, otro, recolecciones=[item])["recolecciones"][0]
    assert r["estado"] == "rechazado"


def test_admin_no_usa_push(client, admin):
    r = client.post("/sync/push", json={"recolecciones": []}, headers=cab(admin))
    assert r.status_code == 403


def test_cadena_canonica_documentada():
    """El mismo ejemplo está en docs/sincronizacion.md: Android debe producir exactamente esta cadena."""
    r = RecoleccionPush(
        id=uuid.UUID("0b6f1c9e-3a52-4c1e-9d0a-5c3f6b2a7e11"), productor_id=42, litros=Decimal("23.5"),
        observacion="Tarro azul", registrada_en=datetime(2026, 10, 10, 7, 5, 9, 120456, tzinfo=timezone.utc),
        latitud=Decimal("-15.6145123"), longitud=Decimal("-69.97231"), precision_m=Decimal("8.46"),
        origen_ubicacion="gps", ubicacion_simulada=False, hora_gps=None, hora_automatica=True, hash_anterior=None)
    assert cadena_canonica(r) == (
        "v1|0b6f1c9e-3a52-4c1e-9d0a-5c3f6b2a7e11|id:42|23.50|2026-10-10T07:05:09.120Z|-15.614512|-69.972310|8.5"
        "|gps|false||true|412e239b417a846a962cd5f1298859f8a08f3c43828820b957d8c62204ed9030|")
