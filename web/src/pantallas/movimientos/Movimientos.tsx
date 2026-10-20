import { useId, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { listarMovimientos } from "../../api/movimientos";
import type { Movimiento, TipoMovimiento } from "../../api/tipos";
import { fecha, hoyLima, nombreMes, primerDiaDelMes, soles } from "../../comun/formato";
import { useCarga } from "../../comun/useCarga";
import { useTitulo } from "../../comun/useTitulo";

const MES = /^\d{4}-\d{2}$/;

export const TIPOS: { valor: TipoMovimiento; texto: string }[] = [
  { valor: "venta", texto: "Venta" },
  { valor: "pago_productor", texto: "Pago a productor" },
  { valor: "compra_insumo", texto: "Compra de insumo" },
  { valor: "gasto", texto: "Gasto" },
  { valor: "costo_lote", texto: "Costo de lote" },
  { valor: "merma", texto: "Merma de leche" },
  { valor: "baja", texto: "Baja de producto" },
];
const TEXTO = new Map(TIPOS.map((t) => [t.valor, t.texto]));

/** Movimientos del mes (solo lectura): el libro de ventas, pagos, compras, gastos, costos de lote, mermas y bajas. */
export default function Movimientos() {
  useTitulo("Movimientos");
  const id = useId();
  const [hoy] = useState(() => hoyLima());
  const [parametros, setParametros] = useSearchParams();
  const pedido = parametros.get("mes");
  const aaaaMm = pedido !== null && MES.test(pedido) ? pedido : hoy.slice(0, 7);
  const pedidoTipo = parametros.get("tipo");
  const tipo = TIPOS.find((t) => t.valor === pedidoTipo)?.valor ?? null;
  const mes = primerDiaDelMes(aaaaMm);
  const { carga, recargar } = useCarga(() => listarMovimientos(mes, tipo), [mes, tipo]);

  function cambiar(nuevoMes: string, nuevoTipo: TipoMovimiento | null) {
    setParametros(nuevoTipo === null ? { mes: nuevoMes } : { mes: nuevoMes, tipo: nuevoTipo });
  }

  const filas = carga.estado === "listo" ? carga.datos : [];
  const total = (columna: "ingreso" | "egreso" | "perdida") =>
    Math.round(filas.reduce((s, f) => s + (f[columna] ?? 0), 0) * 100) / 100;

  return (
    <>
      <div className="encabezado">
        <h1>Movimientos</h1>
      </div>
      <div className="filtros">
        <div className="campo">
          <label htmlFor={`${id}-mes`}>Mes</label>
          <input id={`${id}-mes`} type="month" max={hoy.slice(0, 7)} value={aaaaMm}
                 onChange={(e) => MES.test(e.target.value) && cambiar(e.target.value, tipo)} />
        </div>
        <div className="campo">
          <label htmlFor={`${id}-tipo`}>Tipo</label>
          <select id={`${id}-tipo`} value={tipo ?? ""}
                  onChange={(e) => cambiar(aaaaMm, TIPOS.find((t) => t.valor === e.target.value)?.valor ?? null)}>
            <option value="">Todos</option>
            {TIPOS.map((t) => <option key={t.valor} value={t.valor}>{t.texto}</option>)}
          </select>
        </div>
      </div>
      <ul className="lista-avisos texto-suave">
        <li>Pagos a productores: se muestran en la fecha en que se pagó la liquidación (pago real). El flujo del
          Resumen cuenta la leche en la fecha de entrega, así que el total del mes puede no coincidir.</li>
        <li>Pérdidas (mermas y bajas) no mueven dinero. El resultado del Resumen además cuenta lo pagado en jornadas
          sin leche aprobada.</li>
        <li>Los sueldos de acopiadores aparecen una vez, como gasto "Sueldo acopiador".</li>
      </ul>

      {carga.estado === "cargando" && <p>Cargando…</p>}
      {carga.estado === "error" && (
        <p className="aviso aviso-error" role="alert">
          {carga.mensaje}{" "}
          <button type="button" className="boton-enlace" onClick={recargar}>Reintentar</button>
        </p>
      )}
      {carga.estado === "listo" && (filas.length === 0 ? (
        <p className="texto-suave">
          No hay movimientos{tipo === null ? "" : ` de tipo "${TEXTO.get(tipo)}"`} en {nombreMes(mes)}.
        </p>
      ) : (
        <table className="tabla" aria-label={`Movimientos de ${nombreMes(mes)}`}>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Tipo</th>
              <th>Descripción</th>
              <th>Referencia</th>
              <th className="numero">Ingreso</th>
              <th className="numero">Egreso</th>
              <th className="numero">Pérdida</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f, n) => (
              <tr key={n}>
                <td>{fecha(f.fecha)}</td>
                <td>{TEXTO.get(f.tipo)}</td>
                <td>{f.descripcion}</td>
                <td><Referencia fila={f} /></td>
                <td className="numero">{f.ingreso === null ? "" : soles(f.ingreso)}</td>
                <td className="numero">{f.egreso === null ? "" : soles(f.egreso)}</td>
                <td className="numero">{f.perdida === null ? "" : soles(f.perdida)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={4}><strong>Total ({filas.length} {filas.length === 1 ? "movimiento" : "movimientos"})</strong></td>
              <td className="numero"><strong>{soles(total("ingreso"))}</strong></td>
              <td className="numero"><strong>{soles(total("egreso"))}</strong></td>
              <td className="numero"><strong>{soles(total("perdida"))}</strong></td>
            </tr>
          </tbody>
        </table>
      ))}
    </>
  );
}

/** El pago a productor enlaza a su liquidación; los demás muestran el código del lote, si lo hay. */
function Referencia({ fila }: { fila: Movimiento }) {
  if (fila.tipo === "pago_productor" && fila.liquidacion_id !== null) {
    return <Link to={`/pagos/liquidaciones/${fila.liquidacion_id}`}>Liquidación n.º {fila.liquidacion_id}</Link>;
  }
  return <>{fila.referencia ?? ""}</>;
}
