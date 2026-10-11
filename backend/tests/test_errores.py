import uuid

import psycopg
import pytest

from app.errores import traducir
from conftest import cab, crear_acopiador


def test_error_de_trigger_se_traduce_a_409(db):
    """fn_validar_recoleccion: un acopiador no puede registrar a un productor externo."""
    with pytest.raises(psycopg.Error) as e:
        with db.transaction():
            db.execute("""
                INSERT INTO recoleccion (id, productor_id, registrado_por, litros, registrada_en, origen_ubicacion)
                VALUES (%s,
                        (SELECT id FROM productor WHERE tipo = 'externo' LIMIT 1),
                        (SELECT id FROM usuario WHERE dni = '41234567'),
                        10, now(), 'ninguna')
            """, (uuid.uuid4(),))
    t = traducir(e.value)
    assert (t.status, t.codigo, t.mensaje) == (409, "conflicto", "Un acopiador solo registra productores de ruta")


def test_trigger_diferido_se_traduce(db):
    """fn_exigir_analisis (al COMMIT): una alterada sin análisis se rechaza con el mensaje de la base."""
    with pytest.raises(psycopg.Error) as e:
        with db.transaction():
            db.execute("""
                UPDATE recoleccion SET estado_calidad = 'alterado'
                 WHERE id = (SELECT r.id FROM recoleccion r
                              WHERE NOT EXISTS (SELECT 1 FROM analisis_calidad a WHERE a.recoleccion_id = r.id)
                              LIMIT 1)
            """)
    t = traducir(e.value)
    assert t.status == 409
    assert "requiere su análisis de calidad" in t.mensaje


def test_unique_por_api_es_409(client, admin):
    nombre = f"Ruta duplicada {uuid.uuid4().hex[:6]}"
    assert client.post("/rutas", json={"nombre": nombre}, headers=cab(admin)).status_code == 201
    r = client.post("/rutas", json={"nombre": nombre}, headers=cab(admin))
    assert r.status_code == 409
    assert r.json() == {"codigo": "conflicto", "mensaje": "Ya existe una ruta con ese nombre"}


def test_check_por_api_es_422(client, admin):
    r = client.post("/productores", json={"nombre": "Externo sin datos", "tipo": "externo"}, headers=cab(admin))
    assert r.status_code == 422
    assert r.json()["mensaje"].startswith("Un productor de ruta necesita ruta")

    r = client.post("/acopiadores", json={"nombre_completo": "X", "dni": "123", "celular": "951111111",
                                          "pin_inicial": "1234", "color_hex": "#ABCDEF", "vehiculo": "motocarga"},
                    headers=cab(admin))
    assert r.status_code == 422
    assert r.json()["mensaje"] == "El DNI debe tener 8 dígitos"


def test_color_repetido_y_transaccion_completa(client, admin, db):
    """Si falla el INSERT de acopiador, tampoco queda el usuario (misma transacción)."""
    a = crear_acopiador(client, admin)
    dni_b = "7" + uuid.uuid4().int.__str__()[:7]
    r = client.post("/acopiadores", json={"nombre_completo": "B", "dni": dni_b, "celular": "951111111",
                                          "pin_inicial": "1234", "color_hex": a["color_hex"],
                                          "vehiculo": "moto_lineal"}, headers=cab(admin))
    assert r.status_code == 409
    assert r.json()["mensaje"] == "Ese color ya lo usa otro acopiador"
    assert db.execute("SELECT 1 FROM usuario WHERE dni = %s", (dni_b,)).fetchone() is None


def test_validacion_de_entrada_en_espanol(client, admin):
    r = client.post("/precios-leche", json={"tipo": "otro", "precio_litro": "abc"}, headers=cab(admin))
    assert r.status_code == 422
    cuerpo = r.json()
    assert cuerpo["codigo"] == "validacion"
    campos = {e["campo"]: e["mensaje"] for e in cuerpo["errores"]}
    assert campos == {"tipo": "Valor no permitido", "precio_litro": "Debe ser un número",
                      "vigente_desde": "Campo obligatorio"}
