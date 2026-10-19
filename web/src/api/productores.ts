// Productores (backend/app/routers/productores.py): lista desde v_productor_resumen, edición y aprobación.
import { pedir } from "./cliente";
import type { Productor, ProductorCambios, ProductorNuevo, ProductorResumen, RecoleccionDetalle } from "./tipos";

/** Todos, también los inactivos: los filtros se aplican en la pantalla. Pendientes de aprobación primero. */
export const listarProductores = () =>
  pedir<ProductorResumen[]>("GET", "/productores", { consulta: { incluir_inactivos: true } });
export const obtenerProductor = (id: number) => pedir<Productor>("GET", `/productores/${id}`);
export const crearProductor = (datos: ProductorNuevo) => pedir<Productor>("POST", "/productores", { cuerpo: datos });
export const editarProductor = (id: number, cambios: ProductorCambios) =>
  pedir<Productor>("PATCH", `/productores/${id}`, { cuerpo: cambios });
/** Alta de campo → aprobado: la base deja de retener su leche por "no aprobado" (v_recoleccion_pago). */
export const aprobarProductor = (id: number) => pedir<Productor>("POST", `/productores/${id}/aprobar`);
/** Las más recientes primero. */
export const recoleccionesDeProductor = (id: number, limit: number) =>
  pedir<RecoleccionDetalle[]>("GET", `/productores/${id}/recolecciones`, { consulta: { limit } });
