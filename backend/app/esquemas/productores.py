from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from . import Entrada

TipoProductor = Literal["de_ruta", "externo"]


class ProductorNuevo(Entrada):
    nombre: str = Field(min_length=1)
    documento: str | None = None
    celular: str | None = None
    tipo: TipoProductor = "de_ruta"
    ruta_id: int | None = None
    latitud_ref: float | None = None
    longitud_ref: float | None = None


class ProductorCambios(Entrada):
    nombre: str | None = Field(default=None, min_length=1)
    documento: str | None = None
    celular: str | None = None
    tipo: TipoProductor | None = None
    ruta_id: int | None = None
    latitud_ref: float | None = None
    longitud_ref: float | None = None
    activo: bool | None = None


class Productor(BaseModel):
    """Fila de la tabla productor (formulario de edición)."""
    id: int
    codigo: str
    nombre: str
    documento: str | None
    celular: str | None
    tipo: TipoProductor
    ruta_id: int | None
    latitud_ref: float | None
    longitud_ref: float | None
    aprobado: bool
    creado_por: int | None
    uuid_cliente: UUID | None
    activo: bool
    actualizado_en: datetime


class ProductorResumen(BaseModel):
    """Fila de v_productor_resumen (+ activo de la tabla)."""
    productor_id: int
    codigo: str
    nombre: str
    tipo: TipoProductor
    ruta_id: int | None
    pendiente_aprobacion: bool
    acopiador: str | None
    color_hex: str | None
    litros_total: float
    litros_descartados: float
    n_recolecciones: int
    ultima_recoleccion: datetime | None
    sancionado: bool
    bloqueado: bool
    sancion_hasta: date | None
    activo: bool


class ProductorObservado(BaseModel):
    """Fila de v_productor_observado."""
    productor_id: int
    codigo: str
    nombre: str
    tipo: TipoProductor
    ruta_id: int | None
    ruta: str | None
    acopiador: str | None
    color_hex: str | None
    sancion_id: int
    recoleccion_origen_id: UUID | None
    tipo_sancion: Literal["precio", "bloqueo"]
    estado: Literal["inicia_manana", "en_sancion", "bloqueado"]
    sancion_desde: date
    sancion_hasta: date
    dias_restantes: int
    precio_sancion_litro: float | None
    ph: float | None
    temperatura_c: float | None
    grasa_pct: float | None
    densidad: float | None
    antibioticos_positivo: bool | None
    foto_url: str | None
