import type { Dashboard } from "../../api/tipos";
import { soles } from "../../comun/formato";

type Flujo = Dashboard["flujo"];

const ANCHO = 640;
const ALTO_FILA = 30;
const X_BARRA = 120;          // a la izquierda, el nombre de la fila
const ANCHO_BARRA = 380;      // largo de la barra más grande; a la derecha va su cifra

/** Filas del gráfico: lo que entró y cada egreso del flujo del mes (v_flujo_mensual). */
export function filasDelFlujo(f: Flujo): { nombre: string; monto: number; tipo: "ingreso" | "egreso" }[] {
  return [
    { nombre: "Ingresos (ventas)", monto: f.ingresos, tipo: "ingreso" },
    { nombre: "Leche", monto: f.egreso_leche, tipo: "egreso" },
    { nombre: "Insumos", monto: f.egreso_insumos, tipo: "egreso" },
    { nombre: "Lotes", monto: f.egreso_lotes, tipo: "egreso" },
    { nombre: "Gastos", monto: f.egreso_operativo, tipo: "egreso" },
  ];
}

/** Barras horizontales del flujo del mes en SVG propio (sin librerías ni style=), con las cifras en texto. */
export function GraficoFlujo({ flujo, mes }: { flujo: Flujo; mes: string }) {
  const filas = filasDelFlujo(flujo);
  const mayor = Math.max(...filas.map((f) => f.monto));
  if (mayor <= 0) return <p className="vacio">Sin entradas ni salidas de caja en {mes}.</p>;
  const descripcion = `Flujo de caja de ${mes}: ingresos ${soles(flujo.ingresos)}; egresos: leche ${soles(flujo.egreso_leche)}, `
    + `insumos ${soles(flujo.egreso_insumos)}, lotes ${soles(flujo.egreso_lotes)}, gastos ${soles(flujo.egreso_operativo)}; `
    + `saldo ${soles(flujo.saldo_caja)}`;

  return (
    <figure className="grafico-flujo">
      <svg className="grafico" viewBox={`0 0 ${ANCHO} ${filas.length * ALTO_FILA}`} role="img" aria-label={descripcion}>
        {filas.map((f, i) => {
          const largo = Math.max(0, (f.monto / mayor) * ANCHO_BARRA);
          const y = i * ALTO_FILA;
          return (
            <g key={f.nombre}>
              <text className="grafico-nombre" x={X_BARRA - 8} y={y + 19} textAnchor="end">{f.nombre}</text>
              <rect className={f.tipo === "ingreso" ? "barra-ingreso" : "barra-egreso"} x={X_BARRA} y={y + 6}
                    width={largo} height={ALTO_FILA - 12} rx="3" />
              <text className="grafico-cifra" x={X_BARRA + largo + 8} y={y + 19}>{soles(f.monto)}</text>
            </g>
          );
        })}
      </svg>
      <figcaption>
        Saldo de caja del mes:{" "}
        <strong className={flujo.saldo_caja < 0 ? "negativo" : undefined}>{soles(flujo.saldo_caja)}</strong>
      </figcaption>
    </figure>
  );
}
