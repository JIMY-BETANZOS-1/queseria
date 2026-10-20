from datetime import date, datetime

from pydantic import BaseModel, Field

from . import Entrada


class MermaNueva(Entrada):
    fecha: date                        # jornada de recolección de la leche perdida
    litros: float                      # mayor que cero y no más que la leche aprobada sin destino: lo exige la base
    motivo: str = Field(min_length=1)


class Merma(BaseModel):
    """Fila de merma_leche con el nombre de quien la registró y su valor de hoy como pérdida."""
    id: int
    fecha: date
    litros: float
    motivo: str
    registrado_por: int
    registrado_por_nombre: str
    creado_en: datetime
    valor_perdida: float | None = Field(
        description="litros × costo por litro útil de la jornada, como en v_resultado_mensual; "
                    "cambia si cambia ese costo (no queda congelado)")
