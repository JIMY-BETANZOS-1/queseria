import type { RecoleccionDetalle } from "../../api/tipos";
import { litros } from "../../comun/formato";
import { MuestraColor } from "../../comun/MuestraColor";

export type Resumen = {
  personaId: number | null;   // null = total del día
  nombre: string;
  color: string | null;
  entregas: number;
  litros: number;
  litrosAlterados: number;
  sinRevisar: number;
  conAlertas: number;
  retenidas: number;
  anuladas: number;
};

function vacio(personaId: number | null, nombre: string, color: string | null): Resumen {
  return { personaId, nombre, color, entregas: 0, litros: 0, litrosAlterados: 0, sinRevisar: 0, conAlertas: 0,
           retenidas: 0, anuladas: 0 };
}

function sumar(s: Resumen, r: RecoleccionDetalle) {
  // Las anuladas solo se cuentan aparte: no se pagan ni cuentan como leche (v_recoleccion_pago, v_leche_jornada)
  if (r.anulada_en !== null) {
    s.anuladas += 1;
    return;
  }
  s.entregas += 1;
  s.litros += r.litros;
  if (r.estado_calidad === "alterado") s.litrosAlterados += r.litros;
  if (!r.revisada) s.sinRevisar += 1;
  if (r.alertas_pendientes > 0) s.conAlertas += 1;
  if (r.retenida) s.retenidas += 1;
}

/** Resumen por quien registró (acopiador o analista), en orden alfabético, más el total del día. */
export function resumir(filas: RecoleccionDetalle[]): { personas: Resumen[]; total: Resumen } {
  const porPersona = new Map<number, Resumen>();
  const total = vacio(null, "Total del día", null);
  for (const r of filas) {
    let s = porPersona.get(r.registrado_por);
    if (!s) {
      s = vacio(r.registrado_por, r.registrado_por_nombre, r.color_hex);
      porPersona.set(r.registrado_por, s);
    }
    sumar(s, r);
    sumar(total, r);
  }
  // Redondeo a 2 decimales (numeric(8,2)): evita restos de coma flotante al sumar
  const redondear = (s: Resumen) => ({ ...s, litros: Math.round(s.litros * 100) / 100,
                                       litrosAlterados: Math.round(s.litrosAlterados * 100) / 100 });
  const personas = [...porPersona.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")).map(redondear);
  return { personas, total: redondear(total) };
}

type Props = {
  filas: RecoleccionDetalle[];
  seleccionada: number | null;
  onElegir: (personaId: number | null) => void;
};

export function ResumenPorPersona({ filas, seleccionada, onElegir }: Props) {
  const { personas, total } = resumir(filas);
  const fila = (s: Resumen, esTotal: boolean) => (
    <tr key={s.personaId ?? "total"}>
      <td>
        {esTotal ? <strong>{s.nombre}</strong> : (
          <button type="button" className="boton-enlace" aria-pressed={seleccionada === s.personaId}
                  onClick={() => onElegir(seleccionada === s.personaId ? null : s.personaId)}>
            {s.color && <MuestraColor color={s.color} />} {s.nombre}
          </button>
        )}
      </td>
      <td className="numero">{s.entregas}</td>
      <td className="numero">{litros(s.litros)}</td>
      <td className="numero">{litros(s.litrosAlterados)}</td>
      <td className="numero">{s.sinRevisar}</td>
      <td className="numero">{s.conAlertas}</td>
      <td className="numero">{s.retenidas}</td>
      <td className="numero">{s.anuladas}</td>
    </tr>
  );

  return (
    <table className="tabla" aria-label="Resumen por persona">
      <thead>
        <tr>
          <th>Registró</th>
          <th className="numero">Entregas</th>
          <th className="numero">Litros</th>
          <th className="numero">Alterados</th>
          <th className="numero">Sin revisar</th>
          <th className="numero">Con alertas</th>
          <th className="numero">Retenidas</th>
          <th className="numero">Anuladas</th>
        </tr>
      </thead>
      <tbody>
        {personas.map((s) => fila(s, false))}
        {fila(total, true)}
      </tbody>
    </table>
  );
}
