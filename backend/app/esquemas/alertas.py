from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field

from . import Entrada


class Alerta(BaseModel):
    """Alerta de una recolección con los datos para revisarla (de v_recoleccion_detalle)."""
    id: int
    recoleccion_id: UUID
    tipo: str
    detalle: str | None
    creada_en: datetime
    revisada_por: int | None
    revisada_en: datetime | None
    resolucion: str | None
    fecha: date
    registrada_en: datetime
    productor_id: int
    productor_codigo: str
    productor: str
    registrado_por: int
    registrado_por_nombre: str
    color_hex: str | None
    litros: float
    recoleccion_retenida: bool | None   # según v_recoleccion_pago (NULL si la recolección está anulada)


class RevisarAlerta(Entrada):
    resolucion: str = Field(min_length=1)


class AnularRecoleccion(Entrada):
    motivo: str = Field(min_length=1)
