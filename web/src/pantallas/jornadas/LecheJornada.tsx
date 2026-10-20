import { useId, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { jornadas } from "../../api/dashboard";
import type { Jornada } from "../../api/tipos";
import { Campo } from "../../comun/Campo";
import { fecha, hoyLima, litros, soles, sumarDias } from "../../comun/formato";
import { Insignia } from "../../comun/Insignia";
import { useCarga } from "../../comun/useCarga";
import { useTitulo } from "../../comun/useTitulo";
import { VentanaMerma } from "./VentanaMerma";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DIAS = 400;   // el máximo que acepta GET /jornadas

/** A8b · La leche de cada día y su destino, de v_leche_jornada, y registrar la merma de una jornada. */
export default function LecheJornada() {
  useTitulo("Leche del día");
  const id = useId();
  const [hoy] = useState(() => hoyLima());
  const [parametros, setParametros] = useSearchParams();
  const desde = parametros.get("desde") ?? sumarDias(hoy, -13);
  const hasta = parametros.get("hasta") ?? hoy;
  const [borrador, setBorrador] = useState({ desde, hasta });
  const [errores, setErrores] = useState<{ desde?: string; hasta?: string }>({});
  const valido = FECHA.test(desde) && FECHA.test(hasta) && hasta >= desde;
  const { carga, recargar } = useCarga(() => (valido ? jornadas(desde, hasta) : Promise.resolve([])), [desde, hasta]);
  const [merma, setMerma] = useState<Jornada | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  function aplicar() {
    const e: typeof errores = {};
    if (!FECHA.test(borrador.desde)) e.desde = "Elija la fecha";
    if (!FECHA.test(borrador.hasta)) e.hasta = "Elija la fecha";
    else if (FECHA.test(borrador.desde) && borrador.hasta < borrador.desde) e.hasta = "No puede ser anterior a la fecha inicial";
    else if (FECHA.test(borrador.desde) && borrador.hasta > sumarDias(borrador.desde, MAX_DIAS - 1)) {
      e.hasta = `Elija como máximo ${MAX_DIAS} días`;
    }
    setErrores(e);
    if (Object.keys(e).length === 0) setParametros({ desde: borrador.desde, hasta: borrador.hasta });
  }

  // De la más reciente a la más antigua
  const filas = carga.estado === "listo" ? [...carga.datos].reverse() : [];
  const suma = (f: (j: (typeof filas)[number]) => number) => Math.round(filas.reduce((s, j) => s + f(j), 0) * 100) / 100;
  const sinDestino = filas.filter((j) => j.sin_destino).length;

  return (
    <>
      <div className="encabezado">
        <h1>Leche del día</h1>
      </div>
      <p className="texto-suave">
        Por día (hora de Lima): lo recolectado, lo descartado, lo que falta revisar y lo aprobado, y qué pasó con lo
        aprobado. "Registrar merma" aparece en las jornadas con leche disponible (aprobada, sin lote ni merma).
      </p>
      {aviso !== null && <p className="aviso aviso-ok" role="status">{aviso}</p>}

      <div className="filtros">
        <Campo id={`${id}-desde`} etiqueta="Desde" error={errores.desde}>
          {(p) => <input {...p} type="date" max={hoy} value={borrador.desde}
                         onChange={(e) => setBorrador((b) => ({ ...b, desde: e.target.value }))} />}
        </Campo>
        <Campo id={`${id}-hasta`} etiqueta="Hasta" error={errores.hasta}>
          {(p) => <input {...p} type="date" max={hoy} value={borrador.hasta}
                         onChange={(e) => setBorrador((b) => ({ ...b, hasta: e.target.value }))} />}
        </Campo>
        <button type="button" className="boton boton-secundario" onClick={aplicar}>Ver</button>
      </div>

      {!valido && <p className="aviso aviso-atencion">El rango de la dirección no es válido: elija las fechas y pulse Ver.</p>}
      {carga.estado === "cargando" && <p>Cargando…</p>}
      {carga.estado === "error" && (
        <p className="aviso aviso-error" role="alert">
          {carga.mensaje}{" "}
          <button type="button" className="boton-enlace" onClick={recargar}>Reintentar</button>
        </p>
      )}
      {carga.estado === "listo" && valido && (filas.length === 0 ? (
        <p className="texto-suave">No hubo leche entre el {fecha(desde)} y el {fecha(hasta)}.</p>
      ) : (
        <>
          <p>
            Del {fecha(desde)} al {fecha(hasta)}: {filas.length} {filas.length === 1 ? "día" : "días"} con leche (los días
            sin recolecciones no aparecen).
          </p>
          {sinDestino > 0 && (
            <p className="aviso aviso-atencion">
              {sinDestino === 1 ? "1 jornada tiene" : `${sinDestino} jornadas tienen`} leche aprobada sin lote ni merma
              pasado el plazo (parámetro "dias_max_leche"): aparecen como "Sin destino".
            </p>
          )}
          <table className="tabla">
            <thead>
              <tr>
                <th>Día</th>
                <th className="numero">Recolectada</th>
                <th className="numero">Descartada</th>
                <th className="numero">Por revisar</th>
                <th className="numero">Aprobada</th>
                <th className="numero">En lotes</th>
                <th className="numero">Merma</th>
                <th className="numero">Disponible</th>
                <th className="numero">Pagado</th>
                <th className="numero">Costo por litro útil</th>
                <th>Estado</th>
                <th><span className="solo-lector">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((j) => (
                <tr key={j.fecha}>
                  <td>{fecha(j.fecha)}</td>
                  <td className="numero">{litros(j.litros_recolectados)}</td>
                  <td className="numero">{litros(j.litros_descartados)}</td>
                  <td className="numero">{litros(j.litros_por_revisar)}</td>
                  <td className="numero">{litros(j.litros_aprobados)}</td>
                  <td className="numero">{litros(j.litros_usados)}</td>
                  <td className="numero">{litros(j.litros_merma)}</td>
                  <td className="numero">{litros(j.litros_disponibles)}</td>
                  <td className="numero">{soles(j.costo_pagado)}</td>
                  <td className="numero">{j.costo_litro_util === null ? "—" : soles(j.costo_litro_util, 4)}</td>
                  <td>
                    {j.sin_destino ? <Insignia tono="error">Sin destino</Insignia>
                      : j.litros_aprobados === 0 ? <Insignia tono="atencion">Sin leche aprobada</Insignia> : ""}
                  </td>
                  <td>
                    {j.litros_disponibles > 0 && (
                      <button type="button" className="boton boton-secundario" aria-label={`Registrar merma del ${fecha(j.fecha)}`}
                              onClick={() => { setAviso(null); setMerma(j); }}>
                        Registrar merma
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              <tr>
                <td><strong>Total</strong></td>
                <td className="numero"><strong>{litros(suma((j) => j.litros_recolectados))}</strong></td>
                <td className="numero"><strong>{litros(suma((j) => j.litros_descartados))}</strong></td>
                <td className="numero"><strong>{litros(suma((j) => j.litros_por_revisar))}</strong></td>
                <td className="numero"><strong>{litros(suma((j) => j.litros_aprobados))}</strong></td>
                <td className="numero"><strong>{litros(suma((j) => j.litros_usados))}</strong></td>
                <td className="numero"><strong>{litros(suma((j) => j.litros_merma))}</strong></td>
                <td className="numero"><strong>{litros(suma((j) => j.litros_disponibles))}</strong></td>
                <td className="numero"><strong>{soles(suma((j) => j.costo_pagado))}</strong></td>
                <td />
                <td />
                <td />
              </tr>
            </tbody>
          </table>
          <p className="texto-suave">
            Costo por litro útil: todo lo pagado ese día (incluida la leche descartada) repartido entre los litros
            aprobados. "Sin leche aprobada": lo pagado ese día cuenta como pérdida en el resultado del mes hasta que se
            apruebe leche de ese día.
          </p>
        </>
      ))}

      {merma !== null && (
        <VentanaMerma jornada={merma} onCerrar={() => setMerma(null)} onHecho={(m) => {
          setMerma(null);
          setAviso(`Merma registrada: ${litros(m.litros)} de la jornada del ${fecha(m.fecha)}`
                   + (m.valor_perdida === null ? "." : `, pérdida de ${soles(m.valor_perdida)} en el resultado.`));
          recargar();
        }} />
      )}
    </>
  );
}
