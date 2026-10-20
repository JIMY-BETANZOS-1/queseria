// Dashboard y leche por jornada (backend/app/routers/dashboard.py): solo lectura de las vistas de la base.
import { pedir } from "./cliente";
import type { Dashboard, Jornada } from "./tipos";

/** `mes`: cualquier día del mes (el servidor lo lleva al primero). */
export const obtenerDashboard = (mes: string) => pedir<Dashboard>("GET", "/dashboard", { consulta: { mes } });
/** Solo los días con leche: los demás no tienen fila. */
export const jornadas = (desde: string, hasta: string) => pedir<Jornada[]>("GET", "/jornadas", { consulta: { desde, hasta } });
