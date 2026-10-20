// Movimientos del mes (backend/app/routers/movimientos.py): libro de solo lectura.
import { pedir } from "./cliente";
import type { Movimiento, TipoMovimiento } from "./tipos";

/** `mes`: cualquier día del mes. Sin `tipo`, todos. */
export const listarMovimientos = (mes: string, tipo: TipoMovimiento | null) =>
  pedir<Movimiento[]>("GET", "/movimientos", { consulta: tipo === null ? { mes } : { mes, tipo } });
