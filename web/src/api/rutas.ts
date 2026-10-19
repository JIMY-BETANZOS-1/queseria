// Rutas y su asignación a acopiadores (backend/app/routers/rutas.py), con historial en ruta_acopiador.
import { pedir } from "./cliente";
import type { Asignacion, Asignar, Ruta, RutaCambios, RutaNueva } from "./tipos";

export const listarRutas = () => pedir<Ruta[]>("GET", "/rutas");
export const obtenerRuta = (id: number) => pedir<Ruta>("GET", `/rutas/${id}`);
export const crearRuta = (datos: RutaNueva) => pedir<Ruta>("POST", "/rutas", { cuerpo: datos });
export const editarRuta = (id: number, cambios: RutaCambios) => pedir<Ruta>("PATCH", `/rutas/${id}`, { cuerpo: cambios });

/** Asigna o reasigna: el servidor cierra la asignación vigente con vigente_hasta = desde. */
export const asignarAcopiador = (rutaId: number, datos: Asignar) =>
  pedir<Asignacion>("PUT", `/rutas/${rutaId}/acopiador`, { cuerpo: datos });
/** Cierra la asignación vigente con fecha de hoy (Lima). */
export const quitarAcopiador = (rutaId: number) => pedir<Asignacion>("DELETE", `/rutas/${rutaId}/acopiador`);
/** La vigente primero, luego de la más reciente a la más antigua. */
export const historialAsignaciones = (rutaId: number) => pedir<Asignacion[]>("GET", `/rutas/${rutaId}/asignaciones`);
