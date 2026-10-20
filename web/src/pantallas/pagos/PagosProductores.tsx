import { useId, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { listarLiquidaciones, pendientesProductores } from "../../api/pagos";
import { fecha, litros, soles } from "../../comun/formato";
import { Insignia } from "../../comun/Insignia";
import { useCarga } from "../../comun/useCarga";
import { useTitulo } from "../../comun/useTitulo";

type FiltroEstado = "pendiente" | "pagado" | "";

/** A11 · Cuentas por pagar a productores y sus liquidaciones. */
export default function PagosProductores() {
  useTitulo("Pagos a productores");
  const id = useId();
  const ubicacion = useLocation();
  const [creadas] = useState(() => (ubicacion.state as { creadas?: number } | null)?.creadas ?? null);
  const pendientes = useCarga(pendientesProductores, []);
  const [estado, setEstado] = useState<FiltroEstado>("pendiente");
  const liquidaciones = useCarga(() => listarLiquidaciones(estado === "" ? null : estado), [estado]);

  const filas = pendientes.carga.estado === "listo" ? pendientes.carga.datos : [];
  const totalPagable = filas.reduce((s, p) => s + p.monto_pagable, 0);
  const totalEspera = filas.reduce((s, p) => s + p.monto_en_espera, 0);

  return (
    <>
      <div className="encabezado">
        <h1>Pagos a productores</h1>
        <Link to="/pagos/liquidar" className="boton boton-primario">Liquidar periodo</Link>
      </div>

      {creadas !== null && (
        <p className="aviso aviso-ok" role="status">
          {creadas === 0 ? "No había nada pagable en ese periodo: no se creó ninguna liquidación."
            : creadas === 1 ? "Se creó 1 liquidación." : `Se crearon ${creadas} liquidaciones.`}
        </p>
      )}

      <section className="seccion" aria-labelledby={`${id}-por-pagar`}>
        <h2 id={`${id}-por-pagar`}>Por pagar</h2>
        <p className="texto-suave">
          Pagable: revisado por calidad y no retenido. En espera: sin revisar, o retenido por un productor no aprobado o
          una alerta sin revisar.
        </p>
        {pendientes.carga.estado === "cargando" && <p>Cargando…</p>}
        {pendientes.carga.estado === "error" && (
          <p className="aviso aviso-error" role="alert">
            {pendientes.carga.mensaje}{" "}
            <button type="button" className="boton-enlace" onClick={pendientes.recargar}>Reintentar</button>
          </p>
        )}
        {pendientes.carga.estado === "listo" && (filas.length === 0 ? (
          <p className="texto-suave">No hay nada por pagar.</p>
        ) : (
          <>
            <p><strong>{soles(totalPagable)}</strong> pagables · {soles(totalEspera)} en espera</p>
            <table className="tabla">
              <thead>
                <tr>
                  <th>Productor</th>
                  <th>Entregas desde</th>
                  <th className="numero">Litros pagables</th>
                  <th className="numero">Pagable</th>
                  <th className="numero">En espera</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((p) => (
                  <tr key={p.productor_id}>
                    <td><Link to={`/productores/${p.productor_id}`}>{p.nombre}</Link> ({p.codigo})</td>
                    <td>{p.desde ? `${fecha(p.desde)} al ${fecha(p.hasta ?? p.desde)}` : ""}</td>
                    <td className="numero">{litros(p.litros_pagables)}</td>
                    <td className="numero">{soles(p.monto_pagable)}</td>
                    <td className="numero">{soles(p.monto_en_espera)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ))}
      </section>

      <section className="seccion" aria-labelledby={`${id}-liquidaciones`}>
        <h2 id={`${id}-liquidaciones`}>Liquidaciones</h2>
        <div className="filtros">
          <div className="campo campo-en-linea">
            <label htmlFor={`${id}-estado`}>Estado</label>
            <select id={`${id}-estado`} value={estado} onChange={(e) => setEstado(e.target.value as FiltroEstado)}>
              <option value="pendiente">Pendientes de pago</option>
              <option value="pagado">Pagadas</option>
              <option value="">Todas</option>
            </select>
          </div>
        </div>
        {liquidaciones.carga.estado === "cargando" && <p>Cargando liquidaciones…</p>}
        {liquidaciones.carga.estado === "error" && (
          <p className="aviso aviso-error" role="alert">
            {liquidaciones.carga.mensaje}{" "}
            <button type="button" className="boton-enlace" onClick={liquidaciones.recargar}>Reintentar</button>
          </p>
        )}
        {liquidaciones.carga.estado === "listo" && (liquidaciones.carga.datos.length === 0 ? (
          <p className="texto-suave">No hay liquidaciones con ese estado.</p>
        ) : (
          <table className="tabla">
            <thead>
              <tr>
                <th>Productor</th>
                <th>Periodo</th>
                <th className="numero">Entregas</th>
                <th className="numero">Litros</th>
                <th className="numero">Monto</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {liquidaciones.carga.datos.map((l) => (
                <tr key={l.liquidacion_id}>
                  <td><Link to={`/pagos/liquidaciones/${l.liquidacion_id}`}>{l.productor}</Link> ({l.productor_codigo})</td>
                  <td>{fecha(l.desde)} al {fecha(l.hasta)}</td>
                  <td className="numero">{l.n_recolecciones}</td>
                  <td className="numero">{litros(l.litros)}</td>
                  <td className="numero">{soles(l.monto)}</td>
                  <td>{l.estado === "pagado" ? <Insignia tono="ok">Pagada</Insignia> : <Insignia tono="atencion">Pendiente</Insignia>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </section>
    </>
  );
}
