// Sesión del admin: token, usuario y hora de vencimiento en sessionStorage (sobrevive a F5, se borra al
// cerrar la pestaña, no se comparte entre pestañas). Nunca en localStorage, en la URL ni en la consola.
import type { Token, UsuarioSesion } from "../api/tipos";

export type Sesion = { token: string; usuario: UsuarioSesion; vence_en: number };
export type MotivoCierre = "salida" | "vencida";

const CLAVE = "queseria.sesion";
// Se cierra un poco antes que el JWT para no enviar peticiones que el servidor ya va a rechazar
export const MARGEN_MS = 30_000;

let sinAlmacen = false;              // sessionStorage bloqueado: la sesión vive solo en memoria de esta página
let memoria: string | null = null;
let cacheCrudo: string | null = null;
let cacheSesion: Sesion | null = null;
let motivo: MotivoCierre | null = null;
let temporizador: ReturnType<typeof setTimeout> | undefined;
const oyentes = new Set<() => void>();

function leerCrudo(): string | null {
  if (sinAlmacen) return memoria;
  try {
    return window.sessionStorage.getItem(CLAVE);
  } catch {
    sinAlmacen = true;
    return memoria;
  }
}

function escribirCrudo(valor: string | null): void {
  memoria = valor;
  if (sinAlmacen) return;
  try {
    if (valor === null) window.sessionStorage.removeItem(CLAVE);
    else window.sessionStorage.setItem(CLAVE, valor);
  } catch {
    sinAlmacen = true;
  }
}

function interpretar(crudo: string | null): Sesion | null {
  if (!crudo) return null;
  try {
    const d = JSON.parse(crudo) as Partial<Sesion>;
    const u = d.usuario;
    if (typeof d.token === "string" && d.token !== "" && typeof d.vence_en === "number"
        && u && typeof u.id === "number" && typeof u.nombre_completo === "string" && typeof u.rol === "string") {
      return { token: d.token, usuario: { id: u.id, rol: u.rol, nombre_completo: u.nombre_completo }, vence_en: d.vence_en };
    }
  } catch {
    // JSON dañado: se trata como sin sesión
  }
  return null;
}

function avisar(): void {
  for (const oyente of oyentes) oyente();
}

function programarVencimiento(sesion: Sesion | null): void {
  clearTimeout(temporizador);
  temporizador = undefined;
  if (sesion) temporizador = setTimeout(revisarVencimiento, Math.max(0, sesion.vence_en - Date.now()));
}

/** Sesión guardada (aunque ya haya vencido). Devuelve el mismo objeto mientras no cambie: sirve para useSyncExternalStore. */
export function sesionGuardada(): Sesion | null {
  const crudo = leerCrudo();
  if (crudo !== cacheCrudo) {
    cacheCrudo = crudo;
    cacheSesion = interpretar(crudo);
    if (crudo !== null && cacheSesion === null) {
      escribirCrudo(null);
      cacheCrudo = null;
    }
    programarVencimiento(cacheSesion);
  }
  return cacheSesion;
}

/** Sesión que todavía se puede usar para llamar a la API, o null. */
export function sesionVigente(ahora: number = Date.now()): Sesion | null {
  const sesion = sesionGuardada();
  return sesion && ahora < sesion.vence_en ? sesion : null;
}

/** Guarda la sesión que devolvió POST /auth/admin/login. */
export function guardarSesion(respuesta: Token, ahora: number = Date.now()): Sesion {
  const sesion: Sesion = {
    token: respuesta.access_token,
    usuario: respuesta.usuario,
    vence_en: ahora + respuesta.expira_en_min * 60_000 - MARGEN_MS,
  };
  escribirCrudo(JSON.stringify(sesion));
  motivo = null;
  sesionGuardada();
  avisar();
  return sesion;
}

/**
 * Cierra la sesión. Devuelve false si no había nada que cerrar, así varios 401 seguidos avisan una sola vez.
 * Con `soloSiToken`, cierra solo si la sesión actual es la de ese token: un 401 tardío de una sesión
 * anterior no cierra la sesión nueva.
 */
export function cerrarSesion(m: MotivoCierre, soloSiToken?: string): boolean {
  const actual = sesionGuardada();
  if (actual === null) return false;
  if (soloSiToken !== undefined && actual.token !== soloSiToken) return false;
  escribirCrudo(null);
  motivo = m;
  sesionGuardada();
  avisar();
  return true;
}

/** Cierra la sesión si ya venció. La llaman el temporizador y el regreso a la pestaña. */
export function revisarVencimiento(): void {
  const sesion = sesionGuardada();
  if (sesion && Date.now() >= sesion.vence_en) cerrarSesion("vencida");
}

/** Por qué se cerró la última sesión (para el aviso de Entrar). Se olvida al entrar de nuevo. */
export function motivoCierre(): MotivoCierre | null {
  return motivo;
}

export function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

/**
 * Revisa el vencimiento al volver a la pestaña o al despertar la laptop (los temporizadores se pausan
 * mientras está suspendida). Devuelve la función para dejar de vigilar.
 */
export function vigilarVencimiento(): () => void {
  const revisar = () => revisarVencimiento();
  window.addEventListener("focus", revisar);
  document.addEventListener("visibilitychange", revisar);
  revisar();
  return () => {
    window.removeEventListener("focus", revisar);
    document.removeEventListener("visibilitychange", revisar);
  };
}

/** Solo para las pruebas: deja el módulo como recién cargado. */
export function reiniciarParaPruebas(): void {
  clearTimeout(temporizador);
  temporizador = undefined;
  sinAlmacen = false;
  memoria = null;
  cacheCrudo = null;
  cacheSesion = null;
  motivo = null;
  oyentes.clear();
}
