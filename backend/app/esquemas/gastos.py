from datetime import date, datetime

from pydantic import BaseModel, Field

from . import Entrada


class CategoriaGasto(BaseModel):
    id: int
    nombre: str
    # false = sus gastos solo los crea otro proceso (el pago mensual del acopiador), no el formulario
    manual: bool


class GastoNuevo(Entrada):
    fecha: date | None = None          # por defecto, hoy en Lima
    categoria_id: int
    descripcion: str | None = None
    monto: float                       # mayor que cero: lo exige la base
    acopiador_id: int | None = None    # opcional: para saber cuánto cuesta cada ruta


class Gasto(BaseModel):
    """Fila de gasto_operativo con los nombres para mostrarla."""
    id: int
    fecha: date
    categoria_id: int
    categoria: str
    descripcion: str | None
    monto: float
    acopiador_id: int | None
    acopiador: str | None
    registrado_por: int
    registrado_por_nombre: str
    creado_en: datetime
    del_pago_mensual: bool = Field(description="Lo creó el pago mensual de un acopiador (pago_acopiador.gasto_id)")
