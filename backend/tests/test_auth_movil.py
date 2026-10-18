import uuid

import pytest

from conftest import (acopiador_con_celular, activar, cab, crear_acopiador, generar_codigo, login_pin)


def test_el_usuario_crea_su_pin_al_activar(client, admin, db):
    acop = crear_acopiador(client, admin)
    # Nace sin PIN: pendiente de activar
    assert acop["pin_pendiente"] is True
    fila = db.execute("SELECT pin_hash, pin_actualizado_en FROM usuario WHERE id = %s", (acop["id"],)).fetchone()
    assert fila["pin_hash"] is None and fila["pin_actualizado_en"] is None

    codigo = generar_codigo(client, admin, acop["id"])
    assert len(codigo) == 8
    # En la base solo queda el hash del código
    fila = db.execute("SELECT codigo_hash FROM codigo_activacion WHERE usuario_id = %s", (acop["id"],)).fetchone()
    assert fila["codigo_hash"] != codigo and len(fila["codigo_hash"]) == 64

    device = str(uuid.uuid4())
    r = activar(client, codigo.lower(), device, pin="4821")    # tolera minúsculas
    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert cuerpo["usuario"]["id"] == acop["id"]
    # Activar ya abre la sesión: trae el token, no hace falta otro login
    assert cuerpo["access_token"] and cuerpo["expira_en_min"] > 0 and cuerpo["dispositivo_id"] > 0
    assert cuerpo["debe_cambiar_pin"] is False
    r = client.get("/sync/pull", headers=cab(cuerpo["access_token"]))
    assert r.status_code == 200, r.text

    fila = db.execute("SELECT pin_actualizado_en FROM usuario WHERE id = %s", (acop["id"],)).fetchone()
    assert fila["pin_actualizado_en"] is not None
    acops = client.get("/acopiadores", headers=cab(admin)).json()
    assert next(a for a in acops if a["id"] == acop["id"])["pin_pendiente"] is False

    r = login_pin(client, device, "4821")
    assert r.status_code == 200, r.text
    assert r.json()["usuario"]["rol"] == "acopiador"
    assert r.json()["debe_cambiar_pin"] is False


def test_codigo_dura_60_minutos(client, admin, db):
    acop = crear_acopiador(client, admin)
    r = client.post(f"/usuarios/{acop['id']}/codigo-activacion", headers=cab(admin))
    assert r.status_code == 201
    fila = db.execute("SELECT expira_en - now() BETWEEN interval '59 min' AND interval '60 min' AS ok "
                      "FROM codigo_activacion WHERE usuario_id = %s AND usado_en IS NULL", (acop["id"],)).fetchone()
    assert fila["ok"]


@pytest.mark.parametrize("pin", ["123", "12345", "123456", "12a4"])
def test_activar_con_pin_mal_formado_no_gasta_el_codigo(client, admin, pin):
    acop = crear_acopiador(client, admin)
    codigo = generar_codigo(client, admin, acop["id"])
    device = str(uuid.uuid4())
    assert activar(client, codigo, device, pin=pin).status_code == 422
    assert activar(client, codigo, device, pin="4821").status_code == 200


def test_activar_con_pin_trivial_no_gasta_el_codigo(client, admin, db):
    acop = crear_acopiador(client, admin)
    codigo = generar_codigo(client, admin, acop["id"])
    device = str(uuid.uuid4())
    for trivial in ("0000", "1234", "4321", "1212", "1122", acop["dni"][-4:], acop["celular"][-4:]):
        r = activar(client, codigo, device, pin=trivial)
        assert r.status_code == 422, trivial
        assert r.json()["codigo"] == "pin_trivial"
    # Nada quedó a medias: sin PIN, sin celular y el código sigue sin usar
    fila = db.execute("SELECT pin_hash FROM usuario WHERE id = %s", (acop["id"],)).fetchone()
    assert fila["pin_hash"] is None
    assert db.execute("SELECT 1 FROM dispositivo WHERE device_uuid = %s", (device,)).fetchone() is None
    assert activar(client, codigo, device, pin="4821").status_code == 200


def test_el_alta_ya_no_recibe_pin_y_no_hay_restablecer(client, admin):
    r = client.post("/analistas", json={"nombre_completo": "Con PIN", "dni": "45678912", "celular": "954445556",
                                        "pin_inicial": "4821"}, headers=cab(admin))
    assert r.status_code == 422          # campo no permitido
    acop = crear_acopiador(client, admin)
    r = client.post(f"/usuarios/{acop['id']}/pin", json={"pin_nuevo": "4821"}, headers=cab(admin))
    assert r.status_code in (404, 405)


def test_pin_del_sistema_anterior_pide_reactivar(client, admin, db):
    """PIN puesto por el admin antes del Bloque 6 (pin_actualizado_en NULL): debe crear el suyo."""
    acop = acopiador_con_celular(client, admin)
    db.execute("UPDATE usuario SET pin_actualizado_en = NULL WHERE id = %s", (acop["id"],))
    r = login_pin(client, acop["device_uuid"], acop["pin"])
    assert r.status_code == 401
    assert r.json()["codigo"] == "debe_reactivar"
    assert r.json()["mensaje"] == "Pida un código nuevo al administrador para crear su PIN"
    r = login_pin(client, acop["device_uuid"], "7319")          # tampoco con otro PIN, y no cuenta
    assert r.json()["codigo"] == "debe_reactivar"
    assert _intentos(db, acop["id"]) == 0

    # Con un código nuevo crea su PIN y vuelve a entrar
    assert activar(client, generar_codigo(client, admin, acop["id"]), acop["device_uuid"], pin="7319").status_code == 200
    assert login_pin(client, acop["device_uuid"], "7319").status_code == 200


def _intentos(db, usuario_id: int) -> int:
    return db.execute("SELECT pin_intentos_fallidos FROM usuario WHERE id = %s", (usuario_id,)).fetchone()[
        "pin_intentos_fallidos"]


@pytest.mark.parametrize("pin", ["123", "12345", "123456", "12a4", ""])
def test_el_pin_tiene_exactamente_4_digitos(client, admin, db, pin):
    acop = acopiador_con_celular(client, admin, pin="4821")
    r = login_pin(client, acop["device_uuid"], pin)
    assert r.status_code == 422
    # Una entrada mal formada nunca llega a verificarse: no cuenta como intento fallido
    assert _intentos(db, acop["id"]) == 0
    r = client.post("/auth/pin/cambiar", json={"pin_actual": "4821", "pin_nuevo": pin}, headers=cab(acop["token"]))
    assert r.status_code == 422


@pytest.mark.parametrize("nuevo", ["0000", "1234", "4321", "1212", "1122"])
def test_cambiar_a_un_pin_trivial_se_rechaza_sin_gastar_intento(client, admin, db, nuevo):
    acop = acopiador_con_celular(client, admin, pin="4821")
    r = client.post("/auth/pin/cambiar", json={"pin_actual": "4821", "pin_nuevo": nuevo}, headers=cab(acop["token"]))
    assert r.status_code == 422
    assert r.json()["codigo"] == "pin_trivial"
    assert r.json()["mensaje"].startswith("Elija un PIN menos obvio: ")
    assert _intentos(db, acop["id"]) == 0
    assert login_pin(client, acop["device_uuid"], "4821").status_code == 200   # el PIN no cambió


def test_cambiar_a_los_ultimos_digitos_del_dni_o_celular_se_rechaza(client, admin):
    acop = acopiador_con_celular(client, admin, pin="4821")
    for propio in (acop["dni"][-4:], acop["celular"][-4:]):
        if propio == "4821":   # DNI o celular al azar que justo termina en el PIN actual: sería pin_repetido
            continue
        r = client.post("/auth/pin/cambiar", json={"pin_actual": "4821", "pin_nuevo": propio},
                        headers=cab(acop["token"]))
        assert r.status_code == 422, propio
        assert r.json()["codigo"] == "pin_trivial"


def test_el_pin_nuevo_debe_ser_distinto_del_actual(client, admin, db):
    """Pendiente (B): antes se aceptaba repetir el PIN y pin_actualizado_en avanzaba igual."""
    acop = acopiador_con_celular(client, admin, pin="4821")
    antes = db.execute("SELECT pin_actualizado_en FROM usuario WHERE id = %s", (acop["id"],)).fetchone()
    r = client.post("/auth/pin/cambiar", json={"pin_actual": "4821", "pin_nuevo": "4821"}, headers=cab(acop["token"]))
    assert r.status_code == 422
    assert r.json()["codigo"] == "pin_repetido"
    assert _intentos(db, acop["id"]) == 0
    despues = db.execute("SELECT pin_actualizado_en FROM usuario WHERE id = %s", (acop["id"],)).fetchone()
    assert antes == despues


def test_pin_actual_incorrecto_si_cuenta_como_intento(client, admin, db):
    acop = acopiador_con_celular(client, admin, pin="4821")
    r = client.post("/auth/pin/cambiar", json={"pin_actual": "4822", "pin_nuevo": "7319"}, headers=cab(acop["token"]))
    assert r.status_code == 401
    assert r.json()["codigo"] == "pin_incorrecto"
    assert _intentos(db, acop["id"]) == 1


def test_codigo_usado_o_vencido_se_rechaza(client, admin, db):
    acop = crear_acopiador(client, admin)
    codigo = generar_codigo(client, admin, acop["id"])
    assert activar(client, codigo).status_code == 200
    r = activar(client, codigo)                          # ya usado
    assert r.status_code == 401
    assert r.json()["mensaje"] == "Código inválido, vencido o ya usado"

    codigo = generar_codigo(client, admin, acop["id"])
    db.execute("UPDATE codigo_activacion SET expira_en = now() - interval '1 minute' "
               "WHERE usuario_id = %s AND usado_en IS NULL", (acop["id"],))
    assert activar(client, codigo).status_code == 401

    # Generar un código nuevo invalida el anterior no usado
    viejo = generar_codigo(client, admin, acop["id"])
    nuevo = generar_codigo(client, admin, acop["id"])
    assert activar(client, viejo).status_code == 401
    assert activar(client, nuevo).status_code == 200


def test_bloqueo_por_intentos_fallidos(client, admin, db):
    acop = acopiador_con_celular(client, admin, pin="4821")
    device = acop["device_uuid"]

    for i in range(1, 5):
        r = login_pin(client, device, "0000")
        assert r.status_code == 401
        assert r.json()["codigo"] == "pin_incorrecto"
        assert r.json()["mensaje"] == f"PIN incorrecto. Le quedan {5 - i} intentos"

    r = login_pin(client, device, "0000")                # 5.º intento: bloquea 15 min
    assert r.status_code == 423
    assert r.json()["codigo"] == "bloqueado"

    r = login_pin(client, device, "4821")                # ni con el PIN correcto mientras dure el bloqueo
    assert r.status_code == 423

    fila = db.execute("""
        SELECT pin_intentos_fallidos, bloqueado_hasta - now() BETWEEN interval '14 min' AND interval '15 min' AS ok
          FROM usuario WHERE id = %s
    """, (acop["id"],)).fetchone()
    assert fila["ok"] and fila["pin_intentos_fallidos"] == 0

    # PIN olvidado o bloqueado: el admin genera un código nuevo y el usuario reactiva el MISMO celular
    # creando otro PIN. Se quita el bloqueo, el PIN viejo deja de servir y el celular es el mismo.
    disp_antes = db.execute("SELECT id FROM dispositivo WHERE device_uuid = %s", (device,)).fetchone()["id"]
    r = activar(client, generar_codigo(client, admin, acop["id"]), device, pin="7319")
    assert r.status_code == 200, r.text
    assert r.json()["dispositivo_id"] == disp_antes
    assert login_pin(client, device, "7319").status_code == 200
    r = login_pin(client, device, "4821")
    assert r.status_code == 401 and r.json()["codigo"] == "pin_incorrecto"


def test_un_solo_celular_activo_por_usuario(client, admin):
    acop = acopiador_con_celular(client, admin)
    viejo, token_viejo = acop["device_uuid"], acop["token"]

    nuevo = str(uuid.uuid4())
    assert activar(client, generar_codigo(client, admin, acop["id"]), nuevo).status_code == 200

    r = client.get(f"/usuarios/{acop['id']}/dispositivos", headers=cab(admin))
    activos = [d["device_uuid"] for d in r.json() if d["activo"]]
    assert activos == [nuevo]

    r = login_pin(client, viejo, acop["pin"])
    assert r.status_code == 401
    assert r.json()["codigo"] == "dispositivo_no_vinculado"
    # El token del celular viejo deja de servir al instante
    r = client.post("/auth/pin/cambiar", json={"pin_actual": acop["pin"], "pin_nuevo": "1111"},
                    headers=cab(token_viejo))
    assert r.status_code == 401
    assert login_pin(client, nuevo, acop["pin"]).status_code == 200


def test_celular_de_otro_usuario(client, admin):
    a = acopiador_con_celular(client, admin)
    b = crear_acopiador(client, admin)
    r = activar(client, generar_codigo(client, admin, b["id"]), a["device_uuid"])
    assert r.status_code == 409
    assert r.json()["mensaje"] == "Este celular ya está vinculado a otro usuario"


def test_admin_desactiva_celular(client, admin):
    acop = acopiador_con_celular(client, admin)
    disp = client.get(f"/usuarios/{acop['id']}/dispositivos", headers=cab(admin)).json()[0]
    r = client.post(f"/dispositivos/{disp['id']}/desactivar", headers=cab(admin))
    assert r.status_code == 200 and r.json()["activo"] is False
    r = login_pin(client, acop["device_uuid"], acop["pin"])
    assert r.status_code == 401
    assert r.json()["codigo"] == "dispositivo_no_vinculado"
