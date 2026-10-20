from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

from . import Entrada

EstadoPago = Literal["pendiente", "pagado"]


# ----------------------------------------------------------------- productores (liquidación semanal)
class PagoPendienteProductor(BaseModel):
    """Fila de v_pago_pendiente_productor: lo pagable ya y lo que está en espera (sin revisar o retenido)."""
    productor_id: int
    codigo: str
    nombre: str
    litros_pagables: float
    monto_pagable: float
    monto_en_espera: float
    desde: date | None
    hasta: date | None


class PagableDelPeriodo(BaseModel):
    """Lo que se liquidaría de un productor en el periodo (vista previa): solo lo pagable y no liquidado."""
    productor_id: int
    codigo: str
    nombre: str
    n_recolecciones: int
    litros: float
    monto: float
    litros_con_sancion: float


class Periodo(Entrada):
    desde: date
    hasta: date


class Liquidacion(BaseModel):
    """Fila de v_liquidacion_productor."""
    liquidacion_id: int
    productor_id: int
    productor_codigo: str
    productor: str
    desde: date
    hasta: date
    estado: EstadoPago
    pagada_en: datetime | None
    n_recolecciones: int
    litros: float
    monto: float
    litros_con_sancion: float
    descuento_sancion: float


class LineaLiquidacion(BaseModel):
    """Una recolección de la liquidación, con los montos congelados en liquidacion_detalle."""
    recoleccion_id: UUID
    registrada_en: datetime
    fecha: date
    litros: float
    precio_litro: float
    con_sancion: bool
    monto: float


class LiquidacionDetalle(Liquidacion):
    lineas: list[LineaLiquidacion]


# ----------------------------------------------------------------- acopiadores (pago mensual)
class AcopiadorMes(BaseModel):
    """Un acopiador en el mes: lo estimado (v_acopiador_mes) y, si existe, su pago registrado (pago_acopiador)."""
    acopiador_id: int
    nombre_completo: str
    activo: bool
    mes: date
    litros: float
    litros_normales: float
    recolecciones: int
    sueldo_base_mensual: float
    comision_estimada: float
    sueldo_estimado: float
    pago_id: int | None
    estado: EstadoPago | None
    pago_litros_mes: float | None
    pago_sueldo_base: float | None
    pago_comision: float | None
    ajustes: float | None
    total: float | None
    pagado_en: datetime | None
    gasto_id: int | None
    nota: str | None


class PagoAcopiadorNuevo(Entrada):
    acopiador_id: int
    mes: date                 # primer día del mes (ck_pago_acopiador_mes)
    ajustes: float = 0        # bonos (+) o descuentos (−)
    nota: str | None = None


class PagoAcopiadorCambios(Entrada):
    ajustes: float | None = None
    nota: str | None = None


class PagoAcopiador(BaseModel):
    """Fila de pago_acopiador."""
    id: int
    acopiador_id: int
    mes: date
    litros_mes: float
    sueldo_base: float
    comision: float
    ajustes: float
    total: float
    estado: EstadoPago
    pagado_en: datetime | None
    gasto_id: int | None
    nota: str | None
    creado_en: datetime
