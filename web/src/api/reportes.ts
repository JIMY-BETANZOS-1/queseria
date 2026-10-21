// Reportes del analista (backend/app/routers/reportes_analista.py): solo informativos, sin valores de calidad.
import { pedir, pedirArchivo } from "./cliente";
import type { ReporteAnalista } from "./tipos";

export const listarReportesAnalista = () => pedir<ReporteAnalista[]>("GET", "/analista/reportes");

/** La foto de la entrega a la que se asoció el reporte (GET /analisis/{recoleccion_id}/foto). */
export const fotoDeReporte = (recoleccionId: string) => pedirArchivo(`/analisis/${recoleccionId}/foto`);
