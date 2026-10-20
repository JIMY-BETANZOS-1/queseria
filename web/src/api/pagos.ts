// Pagos (backend/app/routers/pagos.py): liquidación semanal de productores y pago mensual de acopiadores.
// Las reglas (qué es pagable, periodo único, liquidación vacía, monto del gasto) las aplica la base.
import { pedir } from "./cliente";
import type {
  AcopiadorMes, Liquidacion, LiquidacionDetalle, PagableDelPeriodo, PagoAcopiador, PagoAcopiadorCambios,
  PagoAcopiadorNuevo, PagoPendienteProductor,
} from "./tipos";

export const pendientesProductores = () => pedir<PagoPendienteProductor[]>("GET", "/pagos/productores/pendientes");
export const pagableDelPeriodo = (desde: string, hasta: string) =>
  pedir<PagableDelPeriodo[]>("GET", "/pagos/productores/periodo", { consulta: { desde, hasta } });
/** Una liquidación por productor con lo pagable del periodo, todas o ninguna. */
export const liquidarPeriodo = (desde: string, hasta: string) =>
  pedir<Liquidacion[]>("POST", "/liquidaciones/lote", { cuerpo: { desde, hasta } });
export const listarLiquidaciones = (estado: "pendiente" | "pagado" | null) =>
  pedir<Liquidacion[]>("GET", "/liquidaciones", { consulta: { estado } });
export const obtenerLiquidacion = (id: number) => pedir<LiquidacionDetalle>("GET", `/liquidaciones/${id}`);
export const pagarLiquidacion = (id: number) => pedir<Liquidacion>("POST", `/liquidaciones/${id}/pagar`);
export const eliminarLiquidacion = (id: number) => pedir<void>("DELETE", `/liquidaciones/${id}`);

/** `mes` = primer día del mes (AAAA-MM-01). */
export const acopiadoresDelMes = (mes: string) => pedir<AcopiadorMes[]>("GET", "/pagos/acopiadores", { consulta: { mes } });
export const registrarPagoAcopiador = (datos: PagoAcopiadorNuevo) =>
  pedir<PagoAcopiador>("POST", "/pagos/acopiadores", { cuerpo: datos });
export const editarPagoAcopiador = (id: number, cambios: PagoAcopiadorCambios) =>
  pedir<PagoAcopiador>("PATCH", `/pagos/acopiadores/${id}`, { cuerpo: cambios });
export const eliminarPagoAcopiador = (id: number) => pedir<void>("DELETE", `/pagos/acopiadores/${id}`);
/** Crea su gasto "Sueldo acopiador" y lo marca pagado, en una transacción. */
export const pagarAcopiador = (id: number) => pedir<PagoAcopiador>("POST", `/pagos/acopiadores/${id}/pagar`);
