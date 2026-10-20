from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

from . import Entrada
from .sync import SancionCreada


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


class CalidadAdmin(Entrada):
    """Revisión de calidad hecha por el admin (mientras no exista la app del analista): los mismos campos que
    RevisionCalidad de /sync/calidad. Alterado exige al menos un dato del análisis (lo controla la base)."""
    estado: Literal["normal", "alterado"] = "normal"
    ph: Decimal | None = None
    temperatura_c: Decimal | None = None
    grasa_pct: Decimal | None = None
    densidad: Decimal | None = None
    antibioticos_positivo: bool | None = None


class CalidadRevisada(BaseModel):
    recoleccion: RecoleccionDetalle
    sancion: SancionCreada | None = None
