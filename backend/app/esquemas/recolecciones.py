from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class RecoleccionDetalle(BaseModel):
    """Fila de v_recoleccion_detalle."""
    recoleccion_id: UUID
    registrada_en: datetime
    fecha: date
    productor_id: int
    productor_codigo: str
    productor: str
    tipo_productor: Literal["de_ruta", "externo"]
    productor_pendiente: bool
    ruta_id: int | None
    ruta: str | None
    registrado_por: int
    registrado_por_nombre: str
    color_hex: str | None
    litros: float
    observacion: str | None
    estado_calidad: Literal["normal", "alterado"]
    revisada: bool
    latitud: float | None
    longitud: float | None
    precision_m: float | None
    origen_ubicacion: Literal["gps", "ultima_conocida", "ninguna"]
    ubicacion_simulada: bool
    alertas_pendientes: int
    monto: float | None
    retenida: bool | None
    pagable: bool | None
    liquidada: bool | None
    anulada_en: datetime | None
