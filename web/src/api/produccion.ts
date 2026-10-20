// Producción y venta rápidas (backend/app/routers/produccion.py). Las reglas (leche aprobada disponible, stock,
// lote cerrado con saldo y sin vencer) las aplica la base; sus errores llegan como 409 con su mensaje.
import { pedir } from "./cliente";
import type {
  Cliente, ClienteNuevo, IngresoInsumo, IngresoRegistrado, InsumoEnReceta, InsumoNuevo, InsumoStock, Lote, LoteDisponible,
  PreviaProduccion, ProduccionRapida, Receta, RecetaCambios, RecetaNueva, Venta, VentaRapida,
} from "./tipos";

export const listarRecetas = () => pedir<Receta[]>("GET", "/recetas");
/** Editor (backend/app/routers/recetas.py): con lotes ya hechos no cambian unidad, litros base, rendimiento ni vida útil. */
export const crearReceta = (datos: RecetaNueva) => pedir<Receta>("POST", "/recetas", { cuerpo: datos });
export const cambiarReceta = (id: number, cambios: RecetaCambios) => pedir<Receta>("PATCH", `/recetas/${id}`, { cuerpo: cambios });
/** Reemplaza el conjunto completo de insumos. */
export const ponerInsumosReceta = (id: number, insumos: InsumoEnReceta[]) =>
  pedir<Receta>("PUT", `/recetas/${id}/insumos`, { cuerpo: { insumos } });
/** Almacén (solo lectura): stock, costo promedio y último movimiento de cada insumo activo. */
export const listarInsumos = () => pedir<InsumoStock[]>("GET", "/insumos");
/** Nace sin stock: su costo promedio lo fija la primera compra. */
export const crearInsumo = (datos: InsumoNuevo) => pedir<InsumoStock>("POST", "/insumos", { cuerpo: datos });
/** Compra: la base recalcula el costo promedio ponderado (fn_movimiento_insumo). No se borra desde el panel. */
export const registrarCompra = (insumoId: number, datos: IngresoInsumo) =>
  pedir<IngresoRegistrado>("POST", `/insumos/${insumoId}/ingresos`, { cuerpo: datos });
/** Lo que se necesita y lo que hay (consumo sugerido por la receta), sin escribir nada. */
export const previaProduccion = (receta_id: number, fecha_leche: string, litros: number) =>
  pedir<PreviaProduccion>("GET", "/produccion/previa", { consulta: { receta_id, fecha_leche, litros } });
/** Crea el lote, asigna la leche, consume los insumos y lo cierra, en una transacción. */
export const producir = (datos: ProduccionRapida) => pedir<Lote>("POST", "/produccion", { cuerpo: datos });
export const listarLotes = () => pedir<Lote[]>("GET", "/lotes");
/** Cerrados con saldo, el que vence primero arriba. */
export const lotesDisponibles = () => pedir<LoteDisponible[]>("GET", "/lotes/disponibles");

export const listarClientes = () => pedir<Cliente[]>("GET", "/clientes");
export const crearCliente = (datos: ClienteNuevo) => pedir<Cliente>("POST", "/clientes", { cuerpo: datos });
export const vender = (datos: VentaRapida) => pedir<Venta>("POST", "/ventas", { cuerpo: datos });
export const listarVentas = (desde: string, hasta: string) => pedir<Venta[]>("GET", "/ventas", { consulta: { desde, hasta } });
