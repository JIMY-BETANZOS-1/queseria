import type { RecoleccionDetalle } from "../../api/tipos";
import { Insignia, type Tono } from "../../comun/Insignia";

type DatosPago = Pick<RecoleccionDetalle, "anulada_en" | "liquidada" | "retenida" | "pagable">;

/**
 * Estado de pago de una recolección según v_recoleccion_pago (lo decide la base):
 * anulada > liquidada > retenida (productor no aprobado o alerta que retiene sin revisar) > pagable > por revisar.
 * Las anuladas no están en v_recoleccion_pago: sus campos de pago llegan en null.
 */
export function estadoPago(r: DatosPago): { texto: string; tono: Tono } {
  if (r.anulada_en !== null) return { texto: "Anulada", tono: "neutro" };
  if (r.liquidada) return { texto: "Liquidada", tono: "ok" };
  if (r.retenida) return { texto: "Retenida", tono: "error" };
  if (r.pagable) return { texto: "Pagable", tono: "ok" };
  return { texto: "Por revisar", tono: "atencion" };
}

export function EstadoPago({ recoleccion }: { recoleccion: DatosPago }) {
  const e = estadoPago(recoleccion);
  return <Insignia tono={e.tono}>{e.texto}</Insignia>;
}
