from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from . import Entrada

Vehiculo = Literal["moto_lineal", "motocarga", "vehiculo_mediano"]


class UsuarioMovilNuevo(Entrada):
    nombre_completo: str = Field(min_length=1)
    dni: str
    celular: str


class UsuarioMovilCambios(Entrada):
    nombre_completo: str | None = Field(default=None, min_length=1)
    dni: str | None = None
    celular: str | None = None
    activo: bool | None = None


class AcopiadorNuevo(UsuarioMovilNuevo):
    color_hex: str
    vehiculo: Vehiculo
    sueldo_base_mensual: float = 0
    comision_por_litro: float = 0


class AcopiadorCambios(UsuarioMovilCambios):
    color_hex: str | None = None
    vehiculo: Vehiculo | None = None
    sueldo_base_mensual: float | None = None
    comision_por_litro: float | None = None


class RutaVigente(BaseModel):
    ruta_id: int
    nombre: str
    vigente_desde: date


class UsuarioMovil(BaseModel):
    id: int
    rol: str
    nombre_completo: str
    dni: str
    celular: str
    activo: bool
    pin_bloqueado: bool
    # true = todavía no creó su PIN (o tiene uno del sistema anterior): falta activar su celular
    pin_pendiente: bool
    celular_vinculado: bool


class Acopiador(UsuarioMovil):
    color_hex: str
    vehiculo: Vehiculo
    sueldo_base_mensual: float
    comision_por_litro: float
    rutas: list[RutaVigente]


class CodigoActivacion(BaseModel):
    codigo: str
    expira_en: datetime


class Dispositivo(BaseModel):
    id: int
    usuario_id: int
    device_uuid: str
    modelo: str | None
    activado_en: datetime
    ultimo_acceso: datetime | None
    activo: bool
