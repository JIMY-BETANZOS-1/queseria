// Recolecciones (backend/app/routers/recolecciones.py): las de un día y su anulación.
import { pedir } from "./cliente";
import type { RecoleccionDetalle } from "./tipos";

/** Tope de filas por consulta (el máximo que acepta el backend). */
export const MAX_RECOLECCIONES = 1000;

/** Todas las del día en Lima (AAAA-MM-DD), también las anuladas; las más recientes primero. */
export const recoleccionesDelDia = (fecha: string) =>
  pedir<RecoleccionDetalle[]>("GET", "/recolecciones", {
    consulta: { desde: fecha, hasta: fecha, incluir_anuladas: true, limit: MAX_RECOLECCIONES },
  });

/** Nunca se borra: queda anulada con su motivo. Ya anulada o ya liquidada → 409. */
export const anularRecoleccion = (id: string, motivo: string) =>
  pedir<RecoleccionDetalle>("POST", `/recolecciones/${id}/anular`, { cuerpo: { motivo } });
