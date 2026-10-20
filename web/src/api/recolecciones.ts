// Recolecciones (backend/app/routers/recolecciones.py): las de un día y su anulación.
import { pedir } from "./cliente";
import type { CalidadAdmin, CalidadRevisada, RecoleccionDetalle } from "./tipos";

/** Tope de filas por consulta (el máximo que acepta el backend). */
export const MAX_RECOLECCIONES = 1000;

/** Todas las del día en Lima (AAAA-MM-DD), también las anuladas; las más recientes primero. */
export const recoleccionesDelDia = (fecha: string) =>
  pedir<RecoleccionDetalle[]>("GET", "/recolecciones", {
    consulta: { desde: fecha, hasta: fecha, incluir_anuladas: true, limit: MAX_RECOLECCIONES },
  });

/** Todas las de un periodo (también anuladas), pidiendo de a MAX_RECOLECCIONES hasta traerlas todas. */
export async function recoleccionesDelPeriodo(desde: string, hasta: string): Promise<RecoleccionDetalle[]> {
  const todas: RecoleccionDetalle[] = [];
  for (let offset = 0; ; offset += MAX_RECOLECCIONES) {
    const pagina = await pedir<RecoleccionDetalle[]>("GET", "/recolecciones", {
      consulta: { desde, hasta, incluir_anuladas: true, limit: MAX_RECOLECCIONES, offset },
    });
    todas.push(...pagina);
    if (pagina.length < MAX_RECOLECCIONES) return todas;
  }
}

/** Lista de trabajo de calidad (v_recoleccion_sin_revisar): las más antiguas primero. */
export const sinRevisar = () =>
  pedir<RecoleccionDetalle[]>("GET", "/recolecciones/sin-revisar", { consulta: { limit: MAX_RECOLECCIONES } });

/** El admin revisa como el analista. Alterada exige al menos un dato del análisis (lo controla la base). */
export const revisarCalidad = (id: string, datos: CalidadAdmin) =>
  pedir<CalidadRevisada>("POST", `/recolecciones/${id}/calidad`, { cuerpo: datos });

/** Nunca se borra: queda anulada con su motivo. Ya anulada o ya liquidada → 409. */
export const anularRecoleccion = (id: string, motivo: string) =>
  pedir<RecoleccionDetalle>("POST", `/recolecciones/${id}/anular`, { cuerpo: { motivo } });
