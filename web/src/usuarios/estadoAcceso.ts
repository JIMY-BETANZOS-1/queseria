import type { Tono } from "../comun/Insignia";
import type { UsuarioMovil } from "../api/tipos";

type DatosAcceso = Pick<UsuarioMovil, "activo" | "pin_bloqueado" | "pin_pendiente" | "celular_vinculado">;

/**
 * Estado de acceso a la app móvil, en orden de prioridad:
 * inactivo > PIN bloqueado > pendiente de activar (sin PIN propio) > sin celular activo > celular vinculado.
 */
export function estadoAcceso(u: DatosAcceso): { texto: string; tono: Tono } {
  if (!u.activo) return { texto: "Inactivo", tono: "neutro" };
  if (u.pin_bloqueado) return { texto: "PIN bloqueado", tono: "error" };
  if (u.pin_pendiente) return { texto: "Pendiente de activar", tono: "atencion" };
  if (!u.celular_vinculado) return { texto: "Sin celular", tono: "atencion" };
  return { texto: "Celular vinculado", tono: "ok" };
}
