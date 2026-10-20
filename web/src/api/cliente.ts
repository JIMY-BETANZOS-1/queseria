// Cliente de la API: agrega el token, traduce las respuestas de error y cierra la sesión ante un 401.
// Nunca escribe en la consola ni pone el token o la contraseña en un mensaje de error.
import { cerrarSesion, guardarSesion, sesionVigente, type Sesion } from "../sesion/almacen";
import { API_URL } from "./config";
import type { ErrorCampo, RespuestaError, Token } from "./tipos";

export class ErrorApi extends Error {
  readonly status: number;
  readonly codigo: string;
  readonly errores: ErrorCampo[];

  constructor(status: number, codigo: string, mensaje: string, errores: ErrorCampo[] = []) {
    super(mensaje);
    this.name = "ErrorApi";
    this.status = status;
    this.codigo = codigo;
    this.errores = errores;
  }
}

/** La sesión venció o el servidor la rechazó: la pantalla no muestra error, Entrar avisa y pide volver a entrar. */
export class ErrorSesion extends ErrorApi {
  constructor() {
    super(401, "sesion_vencida", "Su sesión venció. Vuelva a entrar.");
    this.name = "ErrorSesion";
  }
}

export type Metodo = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type Consulta = Record<string, string | number | boolean | null | undefined>;

type Opciones = {
  cuerpo?: unknown;
  /** Archivos (multipart/form-data): el navegador pone el Content-Type con su separador. */
  formulario?: FormData;
  consulta?: Consulta;
  /** false: la petición no lleva token y un 401 es un error normal (login). */
  conSesion?: boolean;
};

function armarUrl(ruta: string, consulta?: Consulta): string {
  const url = new URL(API_URL + ruta);
  for (const [clave, valor] of Object.entries(consulta ?? {})) {
    if (valor !== null && valor !== undefined) url.searchParams.set(clave, String(valor));
  }
  return url.toString();
}

async function leerJson(r: Response): Promise<unknown> {
  try {
    return await r.json();
  } catch {
    return undefined;
  }
}

function esRespuestaError(d: unknown): d is RespuestaError {
  return typeof d === "object" && d !== null
    && typeof (d as RespuestaError).codigo === "string" && typeof (d as RespuestaError).mensaje === "string";
}

function errorDeRespuesta(status: number, datos: unknown): ErrorApi {
  if (esRespuestaError(datos)) {
    const errores = Array.isArray(datos.errores) ? datos.errores : [];
    return new ErrorApi(status, datos.codigo, datos.mensaje, errores);
  }
  if (status >= 500) return new ErrorApi(status, "error_servidor", `Error del servidor (${status})`);
  return new ErrorApi(status, "error", `La API respondió ${status}`);
}

/** Llama a la API y devuelve el JSON de la respuesta (undefined si es 204). */
export async function pedir<T>(metodo: Metodo, ruta: string, opciones: Opciones = {}): Promise<T> {
  const { cuerpo, formulario, consulta, conSesion = true } = opciones;
  const cabeceras: Record<string, string> = {};
  let sesion: Sesion | null = null;

  if (conSesion) {
    sesion = sesionVigente();
    if (sesion === null) {
      // Sin sesión o ya vencida: no se envía nada
      cerrarSesion("vencida");
      throw new ErrorSesion();
    }
    cabeceras["Authorization"] = `Bearer ${sesion.token}`;
  }
  if (cuerpo !== undefined) cabeceras["Content-Type"] = "application/json";

  let r: Response;
  try {
    r = await fetch(armarUrl(ruta, consulta), {
      method: metodo,
      headers: cabeceras,
      body: formulario ?? (cuerpo === undefined ? undefined : JSON.stringify(cuerpo)),
    });
  } catch {
    throw new ErrorApi(0, "sin_conexion", `No se pudo conectar con la API (${API_URL})`);
  }

  if (r.status === 401 && sesion !== null) {
    // Solo cierra si sigue siendo la misma sesión: un 401 tardío no cierra una sesión nueva
    cerrarSesion("vencida", sesion.token);
    throw new ErrorSesion();
  }
  if (!r.ok) throw errorDeRespuesta(r.status, await leerJson(r));
  if (r.status === 204) return undefined as T;
  return (await leerJson(r)) as T;
}

/** POST /auth/admin/login. Un 401 aquí es "Correo o contraseña incorrectos" (mensaje del servidor), no una sesión vencida. */
export async function entrar(email: string, password: string): Promise<Sesion> {
  const token = await pedir<Token>("POST", "/auth/admin/login", { cuerpo: { email, password }, conSesion: false });
  return guardarSesion(token);
}

/** Salir: borra la sesión del navegador. El JWT no se revoca en el servidor: vence solo. */
export function salir(): void {
  cerrarSesion("salida");
}
