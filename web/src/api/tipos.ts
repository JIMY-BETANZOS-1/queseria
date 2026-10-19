// Nombres legibles para los tipos que genera tipos.ps1 desde el OpenAPI del backend (esquema.d.ts).
import type { components } from "./esquema";

type Esquemas = components["schemas"];

export type Token = Esquemas["Token"];
export type UsuarioSesion = Esquemas["UsuarioSesion"];

export type Acopiador = Esquemas["Acopiador"];
export type AcopiadorNuevo = Esquemas["AcopiadorNuevo"];
export type AcopiadorCambios = Esquemas["AcopiadorCambios"];
export type Vehiculo = Acopiador["vehiculo"];
export type RutaVigente = Esquemas["RutaVigente"];
export type UsuarioMovil = Esquemas["UsuarioMovil"];
// Un analista no tiene datos propios: es un usuario móvil (backend/app/routers/usuarios.py, /analistas)
export type Analista = UsuarioMovil;
export type AnalistaNuevo = Esquemas["UsuarioMovilNuevo"];
export type AnalistaCambios = Esquemas["UsuarioMovilCambios"];
export type Ruta = Esquemas["Ruta"];
export type RutaNueva = Esquemas["RutaNueva"];
export type RutaCambios = Esquemas["RutaCambios"];
export type Asignar = Esquemas["Asignar"];
export type Asignacion = Esquemas["Asignacion"];
export type CodigoActivacion = Esquemas["CodigoActivacion"];
export type Dispositivo = Esquemas["Dispositivo"];

// Formato de error de backend/app/errores.py. No está en el OpenAPI: FastAPI declara HTTPValidationError
// para los 422, pero el backend responde siempre {codigo, mensaje} (+ errores en los de validación).
export type ErrorCampo = { campo: string; mensaje: string };
export type RespuestaError = { codigo: string; mensaje: string; errores?: ErrorCampo[] };
