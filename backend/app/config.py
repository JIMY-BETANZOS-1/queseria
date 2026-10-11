"""Configuración leída del .env de la raíz del proyecto (o de variables de entorno)."""
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

RAIZ = Path(__file__).resolve().parents[2]


class Config(BaseSettings):
    model_config = SettingsConfigDict(env_file=RAIZ / ".env", env_file_encoding="utf-8", extra="ignore")

    pghost: str = "localhost"
    pgport: int = 5432
    pguser: str = "postgres"
    pgpassword: str = ""
    pgdatabase: str = "queseria"

    jwt_secret: str = Field(min_length=16)
    jwt_minutos_admin: int = 30
    jwt_minutos_movil: int = 720

    codigo_activacion_horas: int = 24
    pin_max_intentos: int = 5
    pin_bloqueo_min: int = 15

    cors_origenes: str = "http://localhost:5173"

    @property
    def conninfo(self) -> str:
        from psycopg.conninfo import make_conninfo

        return make_conninfo(
            host=self.pghost, port=self.pgport, user=self.pguser,
            password=self.pgpassword, dbname=self.pgdatabase, application_name="queseria-api",
            # zona horaria de negocio: fechas con hora de Lima y current_date = día de Lima
            options="-c TimeZone=America/Lima",
        )


@lru_cache
def config() -> Config:
    return Config()
