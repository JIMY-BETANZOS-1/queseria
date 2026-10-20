"""Guardia del script de la base de demostración (scripts/demo/cargar_demo.py): nunca corre contra otra base.

No se conecta a ninguna base: las conexiones son falsas y registran lo que se intentó hacer.
"""
import importlib.util
import random
from pathlib import Path

import pytest

RUTA = Path(__file__).resolve().parents[1] / "scripts" / "demo" / "cargar_demo.py"
_spec = importlib.util.spec_from_file_location("cargar_demo", RUTA)
demo = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(demo)


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


@pytest.mark.parametrize("base", ["queseria", "queseria_test", "QUESERIA_DEMO", " queseria_demo", "queseria_demo ",
                                  "queseria_demo2", ""])
def test_solo_acepta_queseria_demo_escrita_exacta(base):
    with pytest.raises(demo.BaseNoPermitida):
        demo.verificar_base(base)
    demo.verificar_base("queseria_demo")                     # la única aceptada


def test_si_la_conexion_apunta_a_otra_base_se_detiene():
    with pytest.raises(demo.BaseNoPermitida, match="apunta a 'queseria'"):
        demo.verificar_base("queseria_demo", "queseria")
    demo.verificar_base("queseria_demo", "queseria_demo")


def test_con_otra_base_no_abre_ninguna_conexion():
    abiertas = []

    def conectar(base, solo_lectura=False):
        abiertas.append(base)
        return ConexionFalsa(base, [])

    for base in ("queseria", "queseria_test"):
        assert demo.main(["--base", base, "--fase", "todo"], conectar_fn=conectar) == 2
    assert abiertas == []


def test_si_la_conexion_resulta_ser_otra_base_no_ejecuta_nada_mas():
    registro = []

    def conectar(base, solo_lectura=False):
        return ConexionFalsa("queseria", registro)               # pidió la demo pero la conexión es la real

    assert demo.main(["--base", "queseria_demo", "--fase", "todo"], conectar_fn=conectar) == 2
    assert registro == ["SELECT current_database() AS b"]        # solo preguntó qué base era


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
