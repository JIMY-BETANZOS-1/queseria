// Alertas de las recolecciones (backend/app/routers/alertas.py). Revisar una que retiene el pago lo libera:
// lo decide v_recoleccion_pago.
import { pedir } from "./cliente";
import type { Alerta } from "./tipos";

/** Tope de filas por consulta (el máximo que acepta el backend). */
export const MAX_ALERTAS = 1000;

export type FiltroAlertas = { todas: boolean; tipo: string | null; recoleccion_id: string | null };

/** Sin `todas`, solo las pendientes. El servidor las ordena de la más antigua a la más reciente. */
export const listarAlertas = ({ todas, tipo, recoleccion_id }: FiltroAlertas) =>
  pedir<Alerta[]>("GET", "/alertas", { consulta: { todas: todas || null, tipo, recoleccion_id, limit: MAX_ALERTAS } });

export const revisarAlerta = (id: number, resolucion: string) =>
  pedir<Alerta>("POST", `/alertas/${id}/revisar`, { cuerpo: { resolucion } });
