from pydantic import BaseModel, ConfigDict


class Entrada(BaseModel):
    """Base de los cuerpos de petición: rechaza campos desconocidos."""
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


# PIN del móvil: exactamente 4 dígitos (la base guarda únicamente su hash).
# Que no sea trivial se revisa aparte, al crearlo: seguridad.pin_trivial
PATRON_PIN = r"^[0-9]{4}$"
