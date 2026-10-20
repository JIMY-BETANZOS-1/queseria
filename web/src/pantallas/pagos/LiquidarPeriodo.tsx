import { useId, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { ErrorSesion } from "../../api/cliente";
import { liquidarPeriodo, pagableDelPeriodo } from "../../api/pagos";
import { recoleccionesDelPeriodo } from "../../api/recolecciones";
import { Campo } from "../../comun/Campo";
import { Confirmar } from "../../comun/Confirmar";
import { fecha, hoyLima, litros, semanaAnterior, soles } from "../../comun/formato";
import { mensajeDeError } from "../../comun/useCarga";
import { useTitulo } from "../../comun/useTitulo";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Una fila de la vista previa: lo que se liquida (pagable) y lo que queda en espera, por productor. */
export type FilaPrevia = {
  productorId: number;
  codigo: string;
  nombre: string;
  entregas: number;
  litros: number;
  monto: number;
  litrosConSancion: number;
  enEspera: number;
};

type Previa = { desde: string; hasta: string; filas: FilaPrevia[] };

/**
 * Vista previa: lo pagable (GET /pagos/productores/periodo) y, contadas aquí, las entregas del periodo que quedan
 * "en espera": no anuladas, no liquidadas y no pagables (sin revisar o retenidas), el mismo criterio de
 * v_pago_pendiente_productor.
 */
async function cargarPrevia(desde: string, hasta: string): Promise<FilaPrevia[]> {
  const [pagables, entregas] = await Promise.all([pagableDelPeriodo(desde, hasta), recoleccionesDelPeriodo(desde, hasta)]);
  const filas = new Map<number, FilaPrevia>(pagables.map((p) => [p.productor_id, {
    productorId: p.productor_id, codigo: p.codigo, nombre: p.nombre, entregas: p.n_recolecciones, litros: p.litros,
    monto: p.monto, litrosConSancion: p.litros_con_sancion, enEspera: 0,
  }]));
  for (const r of entregas) {
    if (r.anulada_en !== null || r.liquidada || r.pagable) continue;
    const fila = filas.get(r.productor_id) ?? {
      productorId: r.productor_id, codigo: r.productor_codigo, nombre: r.productor, entregas: 0, litros: 0, monto: 0,
      litrosConSancion: 0, enEspera: 0,
    };
    fila.enEspera += 1;
    filas.set(r.productor_id, fila);
  }
  return [...filas.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/** A11 · Liquidar un periodo (por defecto, la semana anterior de lunes a domingo en Lima). */
export default function LiquidarPeriodo() {
  useTitulo("Liquidar periodo");
  const id = useId();
  const navegar = useNavigate();
  const [parametros, setParametros] = useSearchParams();
  const [porDefecto] = useState(() => semanaAnterior(hoyLima()));
  const desde = parametros.get("desde") ?? porDefecto.desde;
  const hasta = parametros.get("hasta") ?? porDefecto.hasta;
  const [errores, setErrores] = useState<{ desde?: string; hasta?: string }>({});
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);

  function cambiar(clave: "desde" | "hasta", valor: string) {
    setPrevia(null);
    setParametros((p) => {
      const n = new URLSearchParams(p);
      n.set("desde", clave === "desde" ? valor : desde);
      n.set("hasta", clave === "hasta" ? valor : hasta);
      return n;
    }, { replace: true });
  }

  async function verPrevia() {
    const e: typeof errores = {};
    if (!FECHA.test(desde)) e.desde = "Elija la fecha";
    if (!FECHA.test(hasta)) e.hasta = "Elija la fecha";
    else if (FECHA.test(desde) && hasta < desde) e.hasta = "No puede ser anterior a la fecha inicial";
    setErrores(e);
    setError(null);
    if (Object.keys(e).length > 0) return;
    setCargando(true);
    try {
      setPrevia({ desde, hasta, filas: await cargarPrevia(desde, hasta) });
    } catch (err) {
      if (err instanceof ErrorSesion) return;
      setError(mensajeDeError(err));
    } finally {
      setCargando(false);
    }
  }

  const aLiquidar = previa?.filas.filter((f) => f.entregas > 0) ?? [];
  const enEspera = previa?.filas.reduce((s, f) => s + f.enEspera, 0) ?? 0;
  const total = aLiquidar.reduce((s, f) => s + f.monto, 0);

  return (
    <>
      <p className="miga"><Link to="/pagos/productores">Pagos a productores</Link> › Liquidar periodo</p>
      <h1>Liquidar periodo</h1>
      <p className="texto-suave">
        Por defecto, la semana anterior de lunes a domingo. El corte semanal es un dato pendiente del cliente: puede
        elegir otro periodo.
      </p>

      <div className="filtros">
        <Campo id={`${id}-desde`} etiqueta="Desde" error={errores.desde}>
          {(p) => <input {...p} type="date" value={desde} onChange={(e) => cambiar("desde", e.target.value)} />}
        </Campo>
        <Campo id={`${id}-hasta`} etiqueta="Hasta" error={errores.hasta}>
          {(p) => <input {...p} type="date" value={hasta} onChange={(e) => cambiar("hasta", e.target.value)} />}
        </Campo>
        <button type="button" className="boton boton-secundario" onClick={verPrevia} disabled={cargando}>
          {cargando ? "Calculando…" : "Ver vista previa"}
        </button>
      </div>

      {error !== null && <p className="aviso aviso-error" role="alert">{error}</p>}

      {previa !== null && (
        <section className="seccion" aria-labelledby={`${id}-previa`}>
          <h2 id={`${id}-previa`}>Vista previa del {fecha(previa.desde)} al {fecha(previa.hasta)}</h2>
          {enEspera > 0 && (
            <p className="aviso aviso-atencion">
              {enEspera === 1 ? "1 entrega del periodo queda" : `${enEspera} entregas del periodo quedan`} en espera (sin
              revisar o retenidas) y no entran. Se pagarán en otro periodo: la base no deja volver a liquidar este mismo
              periodo para el mismo productor.
            </p>
          )}
          {previa.filas.length === 0 ? (
            <p className="texto-suave">No hay entregas por pagar en ese periodo.</p>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Productor</th>
                  <th className="numero">Entregas a liquidar</th>
                  <th className="numero">Litros</th>
                  <th className="numero">Con sanción</th>
                  <th className="numero">Monto</th>
                  <th className="numero">En espera</th>
                </tr>
              </thead>
              <tbody>
                {previa.filas.map((f) => (
                  <tr key={f.productorId}>
                    <td><Link to={`/productores/${f.productorId}`}>{f.nombre}</Link> ({f.codigo})</td>
                    <td className="numero">{f.entregas}</td>
                    <td className="numero">{litros(f.litros)}</td>
                    <td className="numero">{litros(f.litrosConSancion)}</td>
                    <td className="numero">{soles(f.monto)}</td>
                    <td className="numero">{f.enEspera}</td>
                  </tr>
                ))}
                <tr>
                  <td><strong>Total</strong></td>
                  <td className="numero"><strong>{aLiquidar.reduce((s, f) => s + f.entregas, 0)}</strong></td>
                  <td className="numero"><strong>{litros(Math.round(aLiquidar.reduce((s, f) => s + f.litros, 0) * 100) / 100)}</strong></td>
                  <td />
                  <td className="numero"><strong>{soles(total)}</strong></td>
                  <td className="numero"><strong>{enEspera}</strong></td>
                </tr>
              </tbody>
            </table>
          )}
          <div className="fila-acciones">
            <button type="button" className="boton boton-primario" disabled={aLiquidar.length === 0}
                    onClick={() => setConfirmar(true)}>
              {aLiquidar.length === 1 ? "Crear 1 liquidación" : `Crear ${aLiquidar.length} liquidaciones`}
            </button>
          </div>
        </section>
      )}

      {confirmar && previa !== null && (
        <Confirmar
          titulo="Crear liquidaciones"
          textoConfirmar="Crear liquidaciones"
          onCerrar={() => setConfirmar(false)}
          onConfirmar={async () => {
            const creadas = await liquidarPeriodo(previa.desde, previa.hasta);
            navegar("/pagos/productores", { state: { creadas: creadas.length } });
          }}
        >
          <ul className="lista-avisos">
            <li>Se crea una liquidación por productor con lo pagable del periodo, por {soles(total)} en total. Los montos
              quedan congelados.</li>
            <li>Las entregas en espera no entran: se pagarán en otro periodo, porque la base no deja volver a liquidar este
              mismo periodo para el mismo productor.</li>
            <li>Mientras estén pendientes de pago, se pueden eliminar.</li>
          </ul>
        </Confirmar>
      )}
    </>
  );
}
