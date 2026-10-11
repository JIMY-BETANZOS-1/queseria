from datetime import date, datetime

from pydantic import BaseModel, Field

from . import Entrada


class RutaNueva(Entrada):
    nombre: str = Field(min_length=1)
    descripcion: str | None = None


class RutaCambios(Entrada):
    nombre: str | None = Field(default=None, min_length=1)
    descripcion: str | None = None
    activa: bool | None = None


class Ruta(BaseModel):
    id: int
    nombre: str
    descripcion: str | None
    activa: bool
    actualizado_en: datetime
    acopiador_id: int | None = None
    acopiador: str | None = None
    color_hex: str | None = None


class Asignar(Entrada):
    acopiador_id: int
    desde: date | None = None   # por defecto: hoy (Lima)


class Asignacion(BaseModel):
    id: int
    ruta_id: int
    acopiador_id: int
    acopiador: str | None = None
    vigente_desde: date
    vigente_hasta: date | None
