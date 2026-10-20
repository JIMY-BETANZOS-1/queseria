from typing import Literal

from pydantic import Field

from . import Entrada


class InsumoEnReceta(Entrada):
    insumo_id: int
    cantidad: float          # por litros_base de leche, en la unidad del insumo; mayor que cero lo exige la base


class RecetaNueva(Entrada):
    nombre: str = Field(min_length=1)
    unidad_venta: Literal["unidad", "kilo"]
    precio_venta: float | None = None
    litros_base: float = 100
    rendimiento_base: float | None = None
    dias_vida_util: int | None = None
    activa: bool = True
    insumos: list[InsumoEnReceta] = []


class RecetaCambios(Entrada):
    """Solo los campos enviados. Con lotes ya hechos no cambian unidad_venta, litros_base, rendimiento_base ni
    dias_vida_util (ver routers/recetas.py)."""
    nombre: str | None = Field(default=None, min_length=1)
    unidad_venta: Literal["unidad", "kilo"] | None = None
    precio_venta: float | None = None
    litros_base: float | None = None
    rendimiento_base: float | None = None
    dias_vida_util: int | None = None
    activa: bool | None = None


class InsumosDeReceta(Entrada):
    insumos: list[InsumoEnReceta]
