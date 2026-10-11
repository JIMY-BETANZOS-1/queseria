from datetime import datetime

from pydantic import BaseModel, Field

from . import PATRON_PIN, Entrada


class LoginAdmin(Entrada):
    email: str = Field(min_length=3)
    password: str = Field(min_length=1)


class Activar(Entrada):
    codigo: str = Field(min_length=4, max_length=20)
    device_uuid: str = Field(min_length=8, max_length=100)
    clave_publica: str = Field(min_length=1)
    modelo: str | None = None


class LoginPin(Entrada):
    device_uuid: str = Field(min_length=8, max_length=100)
    pin: str = Field(pattern=PATRON_PIN)


class CambiarPin(Entrada):
    pin_actual: str = Field(pattern=PATRON_PIN)
    pin_nuevo: str = Field(pattern=PATRON_PIN)


class UsuarioSesion(BaseModel):
    id: int
    rol: str
    nombre_completo: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expira_en_min: int
    usuario: UsuarioSesion


class TokenMovil(Token):
    dispositivo_id: int
    debe_cambiar_pin: bool


class DispositivoActivado(BaseModel):
    dispositivo_id: int
    activado_en: datetime
    usuario: UsuarioSesion
