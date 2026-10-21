"""Guardia del script de datos de demostración (scripts/demo/cargar_demo.py): solo corre contra "queseria", con la
bandera --confirmo-datos-ficticios y un respaldo -Fc de esa base hecho en los últimos 10 minutos.

No se conecta a ninguna base ni lee archivos: las conexiones y el respaldo son falsos y registran lo que se intentó.
"""
import base64
import importlib.util
import os
import random
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app import firma
from app.esquemas.sync import RecoleccionPush

RUTA = Path(__file__).resolve().parents[1] / "scripts" / "demo" / "cargar_demo.py"
_spec = importlib.util.spec_from_file_location("cargar_demo", RUTA)
demo = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(demo)

AHORA = datetime(2026, 10, 21, 15, 0, tzinfo=timezone.utc)
BANDERA = "--confirmo-datos-ficticios"


def respaldo(minutos: float = 2, cabecera: bytes = b"PGDMP\x01\x0e", base: str | None = "queseria",
             existe: bool = True, tamano: int = 123_456) -> "demo.Dump":
    return demo.Dump("respaldos/queseria.dump", existe, tamano, AHORA - timedelta(minutes=minutos), cabecera, base)


class ConexionFalsa:
    """Responde current_database() con la base indicada y anota cada SQL que recibe."""

    def __init__(self, base: str, registro: list):
        self.base, self.registro = base, registro

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, consulta, *args):
        self.registro.append(" ".join(str(consulta).split()))
        base = self.base

        class Resultado:
            def fetchone(self):
                return {"b": base}

            def fetchall(self):
                return []
        return Resultado()


def correr(argv, base_conexion="queseria", dump=None):
    """Corre main con conexiones y respaldo falsos; devuelve (código, bases abiertas, SQL, respaldos leídos)."""
    abiertas, registro, leidos = [], [], []

    def conectar(base, solo_lectura=False):
        abiertas.append((base, solo_lectura))
        return ConexionFalsa(base_conexion, registro)

    def inspeccionar(ruta):
        leidos.append(ruta)
        return dump or respaldo()

    antes = os.environ.get("PGDATABASE")
    codigo = demo.main(argv, conectar_fn=conectar, inspeccionar_fn=inspeccionar, ahora_fn=lambda: AHORA)
    assert os.environ.get("PGDATABASE") == antes == "queseria_test"   # nunca apunta las pruebas a la base real
    return codigo, abiertas, registro, leidos


# ------------------------------------------------------------------ base
@pytest.mark.parametrize("base", ["queseria_demo", "queseria_test", "QUESERIA", " queseria", "queseria ", "queseria2", ""])
def test_solo_acepta_queseria_escrita_exacta(base):
    with pytest.raises(demo.BaseNoPermitida):
        demo.verificar_base(base)
    demo.verificar_base("queseria")                          # la única aceptada


def test_si_la_conexion_apunta_a_otra_base_se_detiene():
    with pytest.raises(demo.BaseNoPermitida, match="apunta a 'queseria_test'"):
        demo.verificar_base("queseria", "queseria_test")
    demo.verificar_base("queseria", "queseria")


@pytest.mark.parametrize("base", ["queseria_test", "queseria_demo"])
def test_con_otra_base_no_lee_el_respaldo_ni_abre_conexiones(base):
    codigo, abiertas, _, leidos = correr(["--base", base, BANDERA, "--dump", "x.dump", "--fase", "todo"])
    assert codigo == 2 and abiertas == [] and leidos == []


# ------------------------------------------------------------------ bandera y respaldo
def test_sin_la_bandera_no_hace_nada():
    codigo, abiertas, _, leidos = correr(["--base", "queseria", "--dump", "x.dump", "--fase", "todo"])
    assert codigo == 2 and abiertas == [] and leidos == []
    with pytest.raises(demo.BaseNoPermitida, match="confirmo-datos-ficticios"):
        demo.revisar_permiso(False, respaldo(), AHORA)


def test_sin_respaldo_no_hace_nada():
    codigo, abiertas, _, leidos = correr(["--base", "queseria", BANDERA, "--fase", "todo"])
    assert codigo == 2 and abiertas == [] and leidos == []
    with pytest.raises(demo.BaseNoPermitida, match="Falta --dump"):
        demo.revisar_permiso(True, None, AHORA)


@pytest.mark.parametrize("dump, motivo", [
    (respaldo(existe=False), "No existe"),
    (respaldo(tamano=0), "vacío"),
    (respaldo(cabecera=b"-- PostgreSQL database dump"), "formato custom"),
    (respaldo(base="queseria_test"), "es de la base 'queseria_test'"),
    (respaldo(base=None), "es de la base 'None'"),
    (respaldo(minutos=10.5), "tiene 10 minutos"),
    (respaldo(minutos=60 * 24), "tiene 1440 minutos"),
    (respaldo(minutos=-5), "en el futuro"),
])
def test_respaldo_que_no_sirve_detiene_todo(dump, motivo):
    with pytest.raises(demo.BaseNoPermitida, match=motivo):
        demo.revisar_permiso(True, dump, AHORA)
    for fase in ("listar", "todo"):
        codigo, abiertas, _, leidos = correr(["--base", "queseria", BANDERA, "--dump", "x.dump", "--fase", fase], dump=dump)
        assert codigo == 2 and abiertas == [] and leidos == ["x.dump"]


@pytest.mark.parametrize("minutos", [0, 0.5, 9.9, 10, -0.5])
def test_respaldo_reciente_de_queseria_se_acepta(minutos):
    demo.revisar_permiso(True, respaldo(minutos=minutos), AHORA)


def test_listar_abre_la_conexion_en_solo_lectura():
    codigo, abiertas, registro, _ = correr(["--base", "queseria", BANDERA, "--dump", "x.dump", "--fase", "listar"],
                                           base_conexion="queseria_test")
    assert codigo == 2 and abiertas == [("queseria", True)]
    assert registro == ["SELECT current_database() AS b"]


def test_si_la_conexion_resulta_ser_otra_base_no_ejecuta_nada_mas():
    codigo, abiertas, registro, _ = correr(["--base", "queseria", BANDERA, "--dump", "x.dump", "--fase", "todo"],
                                           base_conexion="queseria_test")
    assert codigo == 2 and abiertas == [("queseria", False)]
    assert registro == ["SELECT current_database() AS b"]        # solo preguntó qué base era


# ------------------------------------------------------------------ limpieza y carga
def test_el_truncate_no_puede_alcanzar_lo_que_se_conserva():
    demo.revisar_alcance({"recoleccion", "alerta_recoleccion"}, set(demo.TRUNCAR))
    with pytest.raises(demo.BaseNoPermitida, match="productor"):
        demo.revisar_alcance({"recoleccion", "productor"}, set(demo.TRUNCAR))
    assert not set(demo.TRUNCAR) & set(demo.CONSERVAR)


def test_conteos_distintos_obligan_al_rollback():
    demo.comparar_conteos({"usuario": 4, "productor": 17}, {"usuario": 4, "productor": 17, "ruta": 3})
    with pytest.raises(demo.ConteoDistinto, match="productor: esperado 17, hay 16"):
        demo.comparar_conteos({"usuario": 4, "productor": 17}, {"usuario": 4, "productor": 16})


def test_las_entregas_quedan_alrededor_de_la_referencia():
    rng = random.Random(7)
    for _ in range(200):
        lat, lon = demo.alrededor(-15.62, -69.98, rng, radio_m=25)
        assert demo.a_metros(-15.62, -69.98, lat, lon) <= 25.5
    # La "lejos" a propósito: 500 m al norte
    assert demo.a_metros(-15.62, -69.98, -15.62 + 500 / demo.M_POR_GRADO, -69.98) == pytest.approx(500, abs=1)


def test_el_celular_de_demostracion_firma_como_la_app():
    """Firma válida para la API y hash_anterior = SHA-256 de la firma anterior (docs/sincronizacion.md)."""
    movil = demo.Movil()
    p = {"id": 7, "lat": -15.5925, "lon": -69.9475}
    hora = datetime(2026, 10, 20, 11, 30, tzinfo=timezone.utc)
    rng = random.Random(3)
    primera = movil.firmar(demo._entrega(p, hora, 10.5, rng))
    segunda = movil.firmar(demo._entrega(p, hora + timedelta(minutes=20), 11.25, rng, sin_gps=True))
    assert primera["hash_anterior"] is None
    assert segunda["hash_anterior"] == firma.hash_de_firma(primera["firma"])
    for item in (primera, segunda):
        assert firma.verificar(RecoleccionPush.model_validate(item), movil.publica) is None
    alterada = {**segunda, "litros": 99}
    assert firma.verificar(RecoleccionPush.model_validate(alterada), movil.publica) is not None
    assert base64.b64decode(movil.publica)                    # clave pública DER en base64
    alta = demo._entrega(None, hora, 9.5, rng, lat=-15.6, lon=-69.97, uuid_cliente=str(uuid.uuid4()))
    assert "productor_id" not in alta and alta["origen_ubicacion"] == "gps"
