// Nombres legibles para los tipos que genera tipos.ps1 desde el OpenAPI del backend (esquema.d.ts).
import type { components } from "./esquema";

type Esquemas = components["schemas"];

export type Token = Esquemas["Token"];
export type UsuarioSesion = Esquemas["UsuarioSesion"];

// Formato de error de backend/app/errores.py. No está en el OpenAPI: FastAPI declara HTTPValidationError
// para los 422, pero el backend responde siempre {codigo, mensaje} (+ errores en los de validación).
export type ErrorCampo = { campo: string; mensaje: string };
export type RespuestaError = { codigo: string; mensaje: string; errores?: ErrorCampo[] };
