import type { ReactNode } from "react";

import { Icono, type NombreIcono } from "./Iconos";
import { Insignia, type Tono } from "./Insignia";

const ICONO_DEL_TONO: Record<Tono, NombreIcono | null> = { ok: "ok", atencion: "reloj", error: "aviso", neutro: null };

/** Etiqueta de estado con ícono según su tono (el ícono es decorativo: el texto dice el estado). */
export function Estado({ tono, icono, children }: { tono: Tono; icono?: NombreIcono; children: ReactNode }) {
  const nombre = icono ?? ICONO_DEL_TONO[tono];
  return (
    <Insignia tono={tono}>
      {nombre && <Icono nombre={nombre} clase="icono-estado" />}
      {children}
    </Insignia>
  );
}

/** Estado vacío: ícono y una frase. */
export function Vacio({ icono, children }: { icono: NombreIcono; children: ReactNode }) {
  return (
    <div className="vacio-bloque">
      <Icono nombre={icono} clase="vacio-icono" />
      <p>{children}</p>
    </div>
  );
}

/** Filtros como botones con su contador (aria-pressed marca el elegido). */
export function FiltroBotones<T extends string>({ etiqueta, opciones, valor, onCambiar }: {
  etiqueta: string; opciones: { valor: T; texto: string; cuenta?: number }[]; valor: T; onCambiar: (v: T) => void;
}) {
  return (
    <div className="filtro-botones" role="group" aria-label={etiqueta}>
      {opciones.map((o) => (
        <button key={o.valor} type="button" className="filtro-boton" aria-pressed={o.valor === valor}
                onClick={() => onCambiar(o.valor)}>
          {o.texto}
          {o.cuenta !== undefined && <span className="contador">{o.cuenta}</span>}
        </button>
      ))}
    </div>
  );
}
