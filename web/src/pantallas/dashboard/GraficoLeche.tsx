import type { Jornada } from "../../api/tipos";
import { fecha, litros, sumarDias } from "../../comun/formato";

/** Un día del gráfico: los días sin leche no vienen de la API y van en cero. */
export type DiaLeche = { fecha: string; aprobados: number; porRevisar: number; descartados: number; total: number };

export function diasDelGrafico(desde: string, dias: number, filas: Jornada[]): DiaLeche[] {
  const porFecha = new Map(filas.map((j) => [j.fecha, j]));
  return Array.from({ length: dias }, (_, i) => {
    const f = sumarDias(desde, i);
    const j = porFecha.get(f);
    return {
      fecha: f,
      aprobados: j?.litros_aprobados ?? 0,
      porRevisar: j?.litros_por_revisar ?? 0,
      descartados: j?.litros_descartados ?? 0,
      total: j?.litros_recolectados ?? 0,
    };
  });
}

const ANCHO_DIA = 48;
const ALTO = 160;
const MARGEN_ABAJO = 18;

/**
 * Litros por día en barras apiladas (aprobada, por revisar, descartada). SVG con atributos y clases de
 * estilos.css: la CSP no permite estilos en línea. Debajo, los mismos datos en una tabla para lectores de pantalla.
 */
export function GraficoLeche({ dias }: { dias: DiaLeche[] }) {
  const maximo = Math.max(1, ...dias.map((d) => d.total));
  const escala = (l: number) => (l / maximo) * (ALTO - MARGEN_ABAJO - 4);
  const total = dias.reduce((s, d) => s + d.total, 0);

  return (
    <figure>
      <svg className="grafico" viewBox={`0 0 ${dias.length * ANCHO_DIA} ${ALTO}`} role="img"
           aria-label={`Litros por día del ${fecha(dias[0]?.fecha ?? "")} al ${fecha(dias.at(-1)?.fecha ?? "")}: ${litros(Math.round(total * 100) / 100)} en total`}>
        {dias.map((d, i) => {
          const x = i * ANCHO_DIA + 8;
          const ancho = ANCHO_DIA - 16;
          const base = ALTO - MARGEN_ABAJO;
          const hAprob = escala(d.aprobados);
          const hRev = escala(d.porRevisar);
          const hDesc = escala(d.descartados);
          return (
            <g key={d.fecha}>
              <title>{`${fecha(d.fecha)}: ${litros(d.total)}`}</title>
              <rect className="barra-aprobada" x={x} y={base - hAprob} width={ancho} height={hAprob} />
              <rect className="barra-por-revisar" x={x} y={base - hAprob - hRev} width={ancho} height={hRev} />
              <rect className="barra-descartada" x={x} y={base - hAprob - hRev - hDesc} width={ancho} height={hDesc} />
              <text x={x + ancho / 2} y={ALTO - 4} textAnchor="middle">{d.fecha.slice(8, 10)}/{d.fecha.slice(5, 7)}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="leyenda">
        <span><svg width="10" height="10" aria-hidden="true"><rect className="barra-aprobada" width="10" height="10" /></svg> Aprobada</span>
        <span><svg width="10" height="10" aria-hidden="true"><rect className="barra-por-revisar" width="10" height="10" /></svg> Por revisar</span>
        <span><svg width="10" height="10" aria-hidden="true"><rect className="barra-descartada" width="10" height="10" /></svg> Descartada</span>
      </figcaption>
      <details>
        <summary>Ver en tabla</summary>
        <table className="tabla" aria-label="Litros por día">
          <thead>
            <tr>
              <th>Día</th>
              <th className="numero">Recolectada</th>
              <th className="numero">Aprobada</th>
              <th className="numero">Por revisar</th>
              <th className="numero">Descartada</th>
            </tr>
          </thead>
          <tbody>
            {dias.map((d) => (
              <tr key={d.fecha}>
                <td>{fecha(d.fecha)}</td>
                <td className="numero">{litros(d.total)}</td>
                <td className="numero">{litros(d.aprobados)}</td>
                <td className="numero">{litros(d.porRevisar)}</td>
                <td className="numero">{litros(d.descartados)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
