import { useId, useState } from "react";
import { Link } from "react-router-dom";

import { ErrorSesion } from "../../api/cliente";
import { revisarCalidad, sinRevisar } from "../../api/recolecciones";
import type { RecoleccionDetalle } from "../../api/tipos";
import { Confirmar } from "../../comun/Confirmar";
import { fecha, fechaHoraLima, litros } from "../../comun/formato";
import { Insignia } from "../../comun/Insignia";
import { MuestraColor } from "../../comun/MuestraColor";
import { mensajeDeError, useCarga } from "../../comun/useCarga";
import { useTitulo } from "../../comun/useTitulo";
import { EstadoPago } from "../productores/EstadoPago";
import { AlteradaVentana } from "./AlteradaVentana";

type Aviso = { tipo: "ok" | "error"; texto: string };

/**
 * A6 (mínima) · Por revisar: el admin confirma la calidad mientras no exista la app del analista
 * (la base acepta al admin en calidad_por). Solo lo revisado y no retenido se paga (v_recoleccion_pago).
 */
export default function Calidad() {
  useTitulo("Calidad");
  const id = useId();
  const { carga, recargar, ponerDatos } = useCarga(sinRevisar, []);
  const [persona, setPersona] = useState("");
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [aConfirmar, setAConfirmar] = useState<RecoleccionDetalle[] | null>(null);
  const [alterada, setAlterada] = useState<RecoleccionDetalle | null>(null);
  const [avisos, setAvisos] = useState<Aviso[]>([]);

  const todas = carga.estado === "listo" ? carga.datos : [];
  const personas = [...new Map(todas.map((r) => [r.registrado_por, r.registrado_por_nombre])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], "es"));
  const filas = persona === "" ? todas : todas.filter((r) => String(r.registrado_por) === persona);
  const seleccion = filas.filter((r) => elegidas.has(r.recoleccion_id));

  function alternar(idRec: string) {
    setElegidas((s) => {
      const n = new Set(s);
      if (n.has(idRec)) n.delete(idRec);
      else n.add(idRec);
      return n;
    });
  }

  function quitar(ids: Set<string>) {
    if (carga.estado !== "listo") return;
    ponerDatos(carga.datos.filter((r) => !ids.has(r.recoleccion_id)));
    setElegidas((s) => new Set([...s].filter((x) => !ids.has(x))));
  }

  /** Una por una: cada revisión es su propia transacción en el servidor. Las que fallan quedan en la lista. */
  async function marcarNormales(lista: RecoleccionDetalle[]) {
    const hechas = new Set<string>();
    const fallas: string[] = [];
    for (const r of lista) {
      try {
        await revisarCalidad(r.recoleccion_id, { estado: "normal" });
        hechas.add(r.recoleccion_id);
      } catch (e) {
        if (e instanceof ErrorSesion) return;
        fallas.push(`${r.productor} (${fechaHoraLima(r.registrada_en)}): ${mensajeDeError(e)}`);
      }
    }
    quitar(hechas);
    setAConfirmar(null);
    const nuevos: Aviso[] = [];
    if (hechas.size > 0) {
      nuevos.push({ tipo: "ok", texto: hechas.size === 1 ? "1 entrega marcada como normal." : `${hechas.size} entregas marcadas como normales.` });
    }
    if (fallas.length > 0) nuevos.push({ tipo: "error", texto: `No se pudieron revisar: ${fallas.join(" · ")}` });
    setAvisos(nuevos);
  }

  return (
    <>
      <div className="encabezado">
        <h1>Calidad: por revisar</h1>
      </div>
      <p className="texto-suave">
        Mientras no exista la app del analista, el admin confirma aquí la calidad. Solo se paga la leche revisada y no
        retenida.
      </p>

      {avisos.map((a) => (
        <p key={a.texto} className={a.tipo === "ok" ? "aviso aviso-ok" : "aviso aviso-error"} role={a.tipo === "ok" ? "status" : "alert"}>
          {a.texto}
        </p>
      ))}

      {carga.estado === "cargando" && <p>Cargando entregas por revisar…</p>}
      {carga.estado === "error" && (
        <p className="aviso aviso-error" role="alert">
          {carga.mensaje}{" "}
          <button type="button" className="boton-enlace" onClick={recargar}>Reintentar</button>
        </p>
      )}
      {carga.estado === "listo" && (todas.length === 0 ? (
        <p className="texto-suave">No hay entregas por revisar.</p>
      ) : (
        <>
          <div className="filtros">
            <div className="campo campo-en-linea">
              <label htmlFor={`${id}-persona`}>Registró</label>
              <select id={`${id}-persona`} value={persona} onChange={(e) => setPersona(e.target.value)}>
                <option value="">Todos</option>
                {personas.map(([pid, nombre]) => <option key={pid} value={pid}>{nombre}</option>)}
              </select>
            </div>
            <button type="button" className="boton boton-primario" disabled={seleccion.length === 0}
                    onClick={() => setAConfirmar(seleccion)}>
              Marcar normales ({seleccion.length})
            </button>
          </div>
          <p><strong>{filas.length}</strong> por revisar, de la más antigua a la más reciente.</p>
          <table className="tabla">
            <thead>
              <tr>
                <th>
                  <input type="checkbox" aria-label="Seleccionar todas las visibles"
                         checked={filas.length > 0 && seleccion.length === filas.length}
                         onChange={(e) => setElegidas(e.target.checked ? new Set(filas.map((r) => r.recoleccion_id)) : new Set())} />
                </th>
                <th>Fecha y hora</th>
                <th>Productor</th>
                <th>Registró</th>
                <th className="numero">Litros</th>
                <th className="numero">Alertas</th>
                <th>Pago</th>
                <th><span className="solo-lector">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((r) => (
                <tr key={r.recoleccion_id}>
                  <td>
                    <input type="checkbox" checked={elegidas.has(r.recoleccion_id)} onChange={() => alternar(r.recoleccion_id)}
                           aria-label={`Seleccionar ${r.productor} ${fechaHoraLima(r.registrada_en)}`} />
                  </td>
                  <td>{fechaHoraLima(r.registrada_en)}</td>
                  <td>
                    <Link to={`/productores/${r.productor_id}`}>{r.productor}</Link> <span className="codigo">({r.productor_codigo})</span>
                    {r.productor_pendiente && <> <Insignia tono="atencion">Pendiente de aprobación</Insignia></>}
                  </td>
                  <td>{r.color_hex && <MuestraColor color={r.color_hex} />} {r.registrado_por_nombre}</td>
                  <td className="numero">{litros(r.litros)}</td>
                  <td className="numero">
                    {r.alertas_pendientes > 0 && (
                      <Link to={`/alertas?recoleccion=${r.recoleccion_id}`}
                            aria-label={`${r.alertas_pendientes} sin revisar: ver alertas`}>{r.alertas_pendientes}</Link>
                    )}
                  </td>
                  <td><EstadoPago recoleccion={r} /></td>
                  <td>
                    <div className="fila-acciones">
                      <button type="button" className="boton boton-secundario" onClick={() => setAConfirmar([r])}>Normal</button>
                      <button type="button" className="boton boton-peligro-suave" onClick={() => setAlterada(r)}>Alterada…</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ))}

      {aConfirmar !== null && (
        <Confirmar
          titulo={aConfirmar.length === 1 ? "Marcar como normal" : `Marcar ${aConfirmar.length} como normales`}
          textoConfirmar="Marcar normal"
          onCerrar={() => setAConfirmar(null)}
          onConfirmar={() => marcarNormales(aConfirmar)}
        >
          {/* v_recoleccion_pago: pagable = revisada y no retenida */}
          <ul className="lista-avisos">
            <li>Quedan revisadas como normales y pasan a pagables, salvo las retenidas (productor no aprobado o alerta que
              retiene sin revisar).</li>
            <li>Quedan revisadas a su nombre. No se puede deshacer desde el panel.</li>
          </ul>
        </Confirmar>
      )}

      {alterada !== null && (
        <AlteradaVentana
          recoleccion={alterada}
          onCerrar={() => setAlterada(null)}
          onHecho={(resultado) => {
            quitar(new Set([alterada.recoleccion_id]));
            setAlterada(null);
            const s = resultado.sancion;
            setAvisos([{
              tipo: "ok",
              texto: `Entrega de ${alterada.productor} marcada como alterada.` + (s
                ? ` La base creó ${s.tipo === "bloqueo" ? "un bloqueo" : "una sanción de precio"} del ${fecha(s.desde)} al ${fecha(s.hasta)}.`
                : ""),
            }]);
          }}
        />
      )}
    </>
  );
}
