"""Sincronización con la app móvil (contrato en docs/sincronizacion.md)."""
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from . import Entrada

MAX_ITEMS = 500
EstadoItem = Literal["creado", "duplicado", "rechazado"]
OrigenUbicacion = Literal["gps", "ultima_conocida", "ninguna"]


class EntradaFirmada(BaseModel):
    """Datos firmados en el celular: NO se recortan espacios (cambiaría la cadena canónica)."""
    model_config = ConfigDict(extra="forbid")


# ----------------------------------------------------------------- push
class ProductorPush(Entrada):
    """Productor dado de alta en el celular. El tipo lo fija la API según el rol del token."""
    uuid_cliente: UUID
    nombre: str = Field(min_length=1)
    documento: str | None = None
    celular: str | None = None
    ruta_id: int | None = None


class RecoleccionPush(EntradaFirmada):
    id: UUID
    productor_id: int | None = None
    productor_uuid_cliente: UUID | None = None
    litros: Decimal
    observacion: str | None = None
    registrada_en: AwareDatetime
    latitud: Decimal | None = None
    longitud: Decimal | None = None
    precision_m: Decimal | None = None
    origen_ubicacion: OrigenUbicacion | None = None
    ubicacion_simulada: bool = False
    hora_gps: AwareDatetime | None = None
    hora_automatica: bool | None = None
    hash_anterior: str | None = None
    firma: str | None = None

    @model_validator(mode="after")
    def _un_productor(self):
        if (self.productor_id is None) == (self.productor_uuid_cliente is None):
            raise ValueError("Indique productor_id o productor_uuid_cliente (solo uno)")
        return self


class LotePush(BaseModel):
    """Los ítems se validan uno por uno: un ítem mal formado se rechaza sin tumbar el lote."""
    model_config = ConfigDict(extra="forbid")
    productores: list[Any] = Field(default_factory=list, max_length=MAX_ITEMS)
    recolecciones: list[Any] = Field(default_factory=list, max_length=MAX_ITEMS)


class ResultadoProductor(BaseModel):
    indice: int
    uuid_cliente: str | None
    estado: EstadoItem
    motivo: str | None = None
    productor_id: int | None = None
    codigo: str | None = None


class ResultadoRecoleccion(BaseModel):
    indice: int
    id: str | None
    estado: EstadoItem
    motivo: str | None = None
    alertas: list[str] = []


class RespuestaPush(BaseModel):
    productores: list[ResultadoProductor]
    recolecciones: list[ResultadoRecoleccion]
    servidor_ahora: datetime


# ----------------------------------------------------------------- calidad
class RevisionCalidad(Entrada):
    recoleccion_id: UUID
    estado: Literal["normal", "alterado"] = "normal"
    ph: Decimal | None = None
    temperatura_c: Decimal | None = None
    grasa_pct: Decimal | None = None
    densidad: Decimal | None = None
    antibioticos_positivo: bool | None = None


class LoteCalidad(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revisiones: list[Any] = Field(max_length=MAX_ITEMS)


class SancionCreada(BaseModel):
    tipo: Literal["precio", "bloqueo"]
    desde: date
    hasta: date


class ResultadoRevision(BaseModel):
    indice: int
    recoleccion_id: str | None
    estado: EstadoItem
    motivo: str | None = None
    sancion: SancionCreada | None = None


class RespuestaCalidad(BaseModel):
    revisiones: list[ResultadoRevision]
    servidor_ahora: datetime


# ----------------------------------------------------------------- pull
class RutaPull(BaseModel):
    id: int
    nombre: str
    descripcion: str | None
    actualizado_en: datetime


class ProductorPull(BaseModel):
    id: int
    codigo: str
    nombre: str
    documento: str | None
    celular: str | None
    tipo: Literal["de_ruta", "externo"]
    ruta_id: int | None
    latitud_ref: float | None
    longitud_ref: float | None
    aprobado: bool
    uuid_cliente: UUID | None
    actualizado_en: datetime


class EstadoProductor(BaseModel):
    """Fila de v_productor_estado_hoy (solo productores con sanción hoy; el resto está normal)."""
    productor_id: int
    sancionado: bool
    bloqueado: bool
    sancion_hasta: date | None


class PreciosVigentes(BaseModel):
    fecha: date
    normal: float | None
    sancion: float | None


class PullBase(BaseModel):
    rol: str
    servidor_ahora: datetime
    siguiente_desde: datetime
    estados: list[EstadoProductor]


class PullAcopiador(PullBase):
    rutas: list[RutaPull]
    ruta_ids_vigentes: list[int]
    productores: list[ProductorPull]
    productor_ids_vigentes: list[int]
    precios: PreciosVigentes


class PullAnalista(PullBase):
    """El analista no sincroniza entregas: baja las rutas activas, los productores de todas ellas y los externos."""
    rutas: list[RutaPull]
    ruta_ids_vigentes: list[int]
    productores: list[ProductorPull]
    productor_ids_vigentes: list[int]


# ----------------------------------------------------------------- mi día
class RecoleccionMiDia(BaseModel):
    recoleccion_id: UUID
    registrada_en: datetime
    productor_id: int
    productor_codigo: str
    productor: str
    litros: float
    estado_calidad: Literal["normal", "alterado"]
    revisada: bool
    anulada_en: datetime | None


class MiDia(BaseModel):
    fecha: date
    total_litros: float
    n_recolecciones: int
    recolecciones: list[RecoleccionMiDia]
