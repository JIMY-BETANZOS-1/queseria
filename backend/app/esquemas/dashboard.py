from datetime import date

from pydantic import BaseModel


class Jornada(BaseModel):
    """Fila de v_leche_jornada: la leche de un día (Lima) y su destino."""
    fecha: date
    litros_recolectados: float
    litros_descartados: float
    litros_por_revisar: float
    litros_aprobados: float
    litros_usados: float
    litros_merma: float
    litros_disponibles: float
    costo_pagado: float
    costo_litro_util: float | None
    dias_antiguedad: int
    sin_destino: bool


class LecheMes(BaseModel):
    """Suma de v_leche_jornada en los días del mes."""
    litros_recolectados: float
    litros_descartados: float
    litros_por_revisar: float
    litros_aprobados: float
    costo_pagado: float


class Flujo(BaseModel):
    """Fila de v_flujo_mensual (en cero si el mes no tiene movimientos)."""
    ingresos: float
    egreso_leche: float
    egreso_insumos: float
    egreso_lotes: float
    egreso_operativo: float
    total_invertido: float
    saldo_caja: float


class Resultado(BaseModel):
    """Fila de v_resultado_mensual (en cero si el mes no tiene movimientos)."""
    ingresos: float
    costo_ventas: float
    perdida_producto: float
    perdida_leche: float
    gasto_operativo: float
    utilidad_neta: float


class PorPagar(BaseModel):
    """Totales de v_pago_pendiente_productor y de las liquidaciones aún sin pagar."""
    monto_pagable: float
    monto_en_espera: float
    liquidaciones_pendientes: int
    monto_liquidaciones_pendientes: float


class Acopiadores(BaseModel):
    """El mes en v_acopiador_mes y pago_acopiador."""
    sueldo_estimado: float
    pagado: float
    pagos_pendientes: int


class Atencion(BaseModel):
    """Lo que el admin tiene que revisar hoy (no depende del mes)."""
    alertas_pendientes: int
    alertas_que_retienen: int
    altas_por_aprobar: int
    entregas_sin_revisar: int
    productores_observados: int


class Dashboard(BaseModel):
    mes: date
    leche: LecheMes
    flujo: Flujo
    resultado: Resultado
    por_pagar: PorPagar
    acopiadores: Acopiadores
    atencion: Atencion
