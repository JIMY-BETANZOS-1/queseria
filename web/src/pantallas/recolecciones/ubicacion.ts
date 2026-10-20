import type { RecoleccionDetalle } from "../../api/tipos";

/** Texto de la ubicación de una recolección (sin mapa: eso es de W2). La simulada se marca aparte. */
export function textoUbicacion(r: Pick<RecoleccionDetalle, "origen_ubicacion" | "precision_m">): string {
  const precision = r.precision_m === null ? "" : ` ±${Math.round(r.precision_m)} m`;
  switch (r.origen_ubicacion) {
    case "gps": return `GPS${precision}`;
    case "ultima_conocida": return `Última conocida${precision}`;
    case "ninguna": return "Sin ubicación";
  }
}
