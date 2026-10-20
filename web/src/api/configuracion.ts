// Parámetros de negocio (backend/app/routers/configuracion.py) y precio de la leche (routers/precios.py).
import { pedir } from "./cliente";
import type { Parametro, Precio, PrecioNuevo } from "./tipos";

export const listarParametros = () => pedir<Parametro[]>("GET", "/configuracion");
/** El servidor exige que el valor conserve el formato del actual (entero, número, true/false, color). */
export const editarParametro = (clave: string, valor: string) =>
  pedir<Parametro>("PUT", `/configuracion/${encodeURIComponent(clave)}`, { cuerpo: { valor } });

/** Historial: el más reciente primero. No se edita ni se borra. */
export const historialPrecios = () => pedir<Precio[]>("GET", "/precios-leche");
export const nuevoPrecio = (datos: PrecioNuevo) => pedir<Precio>("POST", "/precios-leche", { cuerpo: datos });
