import type { ReactNode } from "react";

export type Tono = "ok" | "atencion" | "error" | "neutro";

/** Etiqueta corta de estado ("Celular vinculado", "Pendiente de activar"…). */
export function Insignia({ tono, children }: { tono: Tono; children: ReactNode }) {
  return <span className={`insignia insignia-${tono}`}>{children}</span>;
}
