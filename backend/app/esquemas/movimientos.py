from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

TipoMovimiento = Literal["venta", "pago_productor", "compra_insumo", "gasto", "costo_lote", "merma", "baja"]


class Movimiento(BaseModel):
    """Una fila del libro del mes. Solo una de ingreso, egreso o pérdida tiene valor."""
    tipo: TipoMovimiento
    fecha: date
    registrado_en: datetime | None = Field(description="Para ordenar los del mismo día")
    descripcion: str
    referencia: str | None = Field(description="Código del lote o del productor, si aplica")
    liquidacion_id: int | None = Field(description="Solo en pago_productor: para abrir la liquidación")
    ingreso: float | None
    egreso: float | None
    perdida: float | None = Field(description="Mermas y bajas: no mueven dinero")
