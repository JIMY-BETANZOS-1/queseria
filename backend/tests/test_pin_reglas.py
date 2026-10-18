"""Reglas del PIN de 4 dígitos (seguridad.pin_trivial). Mismos casos que ReglasPinTest.kt del móvil."""
import pytest

from app.seguridad import pin_trivial


@pytest.mark.parametrize("pin", ["0000", "1111", "9999"])
def test_todos_iguales(pin):
    assert pin_trivial(pin) == "todos los dígitos son iguales"


@pytest.mark.parametrize("pin", ["0123", "1234", "6789", "9876", "4321", "3210"])
def test_secuencias(pin):
    assert pin_trivial(pin) == "es una secuencia"


@pytest.mark.parametrize("pin", ["1212", "1010", "2121", "9090"])
def test_par_repetido(pin):
    assert pin_trivial(pin) == "repite un par de dígitos"


@pytest.mark.parametrize("pin", ["1122", "0011", "9988"])
def test_dobles(pin):
    assert pin_trivial(pin) == "repite dígitos de a dos"


def test_ultimos_digitos_del_dni_y_del_celular():
    assert pin_trivial("7319", dni="41237319") == "son los últimos dígitos de su DNI"
    assert pin_trivial("8426", celular="951238426") == "son los últimos dígitos de su celular"
    assert pin_trivial("7319", dni="41238426", celular="951237318") is None
    assert pin_trivial("7319", dni=None, celular=None) is None


@pytest.mark.parametrize("pin", ["1357", "2580", "7319", "1221", "8901", "0987"])
def test_pines_aceptados(pin):
    assert pin_trivial(pin) is None


def test_se_rechazan_exactamente_204_de_10000():
    """10 iguales + 14 secuencias + 90 XYXY + 90 XXYY (X ≠ Y): ni más ni menos."""
    rechazados = [f"{n:04d}" for n in range(10_000) if pin_trivial(f"{n:04d}") is not None]
    assert len(rechazados) == 204
