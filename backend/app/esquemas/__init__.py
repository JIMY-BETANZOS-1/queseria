from pydantic import BaseModel, ConfigDict


class Entrada(BaseModel):
    """Base de los cuerpos de petición: rechaza campos desconocidos."""
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


# PIN del móvil: solo dígitos (la base guarda únicamente su hash)
PATRON_PIN = r"^[0-9]{4,6}$"
