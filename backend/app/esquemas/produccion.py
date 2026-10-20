from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from . import Entrada


class InsumoDeReceta(BaseModel):
    insumo_id: int
    nombre: str
    unidad: str
    cantidad: float          # por litros_base de leche, en la unidad del insumo


class Receta(BaseModel):
    id: int
    nombre: str
    unidad_venta: Literal["unidad", "kilo"]
    precio_venta: float | None
    litros_base: float
    rendimiento_base: float | None
    dias_vida_util: int | None
    activa: bool
    insumos: list[InsumoDeReceta]
    # Lotes hechos con esta receta: con lotes no cambian unidad_venta, litros_base, rendimiento_base ni dias_vida_util
    n_lotes: int


class InsumoStock(BaseModel):
    """Fila de v_insumo_stock: stock (suma de movimientos), costo promedio ponderado y último ingreso o ajuste."""
    insumo_id: int
    nombre: str
    unidad: str
    stock: float
    estado: Literal["disponible", "sin_stock"]
    costo_unitario: float
    ultima_actualizacion: datetime | None


class InsumoNuevo(Entrada):
    nombre: str = Field(min_length=1)
    unidad: Literal["kg", "g", "l", "ml", "unidad"]


class IngresoInsumo(Entrada):
    """Compra de un insumo. Cantidad y costo los valida la base (ck_mov_signo, ck_mov_costo: ambos mayores que cero)."""
    cantidad: float
    costo_unitario: float
    fecha: date | None = None     # por defecto, ahora; con fecha, el mediodía de ese día en Lima
    nota: str | None = None


class IngresoRegistrado(BaseModel):
    movimiento_id: int
    insumo: InsumoStock           # como quedó: stock y costo promedio recalculados por la base


class InsumoNecesario(BaseModel):
    """Consumo sugerido (conveniencia del backend: cantidad de la receta × litros ÷ litros_base). La base valida el stock."""
    insumo_id: int
    nombre: str
    unidad: str
    necesita: float
    hay: float
    falta: float


class PreviaProduccion(BaseModel):
    leche_disponible: float           # fn_leche_disponible de la jornada
    costo_litro: float | None         # costo por litro útil de la jornada (v_leche_jornada)
    rendimiento_estimado: float | None
    insumos: list[InsumoNecesario]


class ProduccionRapida(Entrada):
    receta_id: int
    fecha_leche: date                         # jornada de la leche que se usa
    litros: float = Field(gt=0)
    cantidad_producida: float = Field(ge=0)   # en la unidad de venta de la receta
    fecha_produccion: date | None = None      # por defecto, hoy en Lima


class Lote(BaseModel):
    """Fila de v_lote_resumen (lo principal)."""
    lote_id: int
    codigo: str
    receta_id: int
    receta: str
    fecha_produccion: date
    estado: Literal["en_proceso", "cerrado"]
    litros_leche: float
    cantidad_producida: float | None
    cantidad_vendida: float
    saldo: float | None
    ingresos: float
    costo_leche: float
    costo_insumos: float
    costo_total: float
    costo_por_unidad: float | None
    rendimiento_teorico: float | None
    desviacion_rendimiento_pct: float | None
    fecha_vencimiento: date | None


class LoteDisponible(BaseModel):
    """Fila de v_lote_disponible: cerrado y con saldo, el que vence primero arriba."""
    lote_id: int
    codigo: str
    receta: str
    fecha_produccion: date
    saldo: float
    fecha_vencimiento: date | None
    dias_para_vencer: int | None
    vencido: bool
    por_vencer: bool
    unidad_venta: Literal["unidad", "kilo"]
    precio_venta: float | None


class ClienteNuevo(Entrada):
    nombre: str = Field(min_length=1)
    tipo: Literal["natural", "empresa"] = "natural"
    documento: str | None = None
    celular: str | None = None


class Cliente(BaseModel):
    id: int
    nombre: str
    tipo: Literal["natural", "empresa"]
    documento: str | None
    celular: str | None


class VentaRapida(Entrada):
    """Venta al contado de un lote cerrado con saldo (una línea)."""
    cliente_id: int
    lote_id: int
    cantidad: float = Field(gt=0)
    precio_unitario: float = Field(ge=0)
    fecha: date | None = None                 # por defecto, hoy en Lima
    observacion: str | None = None


class Venta(BaseModel):
    venta_id: int
    fecha: date
    cliente_id: int
    cliente: str
    lote_id: int
    codigo_lote: str
    receta: str
    cantidad: float
    precio_unitario: float
    subtotal: float
