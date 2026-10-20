import { useId, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { listarAlertas, MAX_ALERTAS } from "../../api/alertas";
import type { Alerta } from "../../api/tipos";
import { fechaHoraLima, litros } from "../../comun/formato";
import { Insignia } from "../../comun/Insignia";
import { MuestraColor } from "../../comun/MuestraColor";
import { useCarga } from "../../comun/useCarga";
import { useTitulo } from "../../comun/useTitulo";
import { useSesion } from "../../sesion/useSesion";
import { RevisarAlerta } from "./RevisarAlerta";
import { retienePago, textoTipoAlerta, TIPOS_ALERTA } from "./tiposAlerta";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pago de la recolección de la alerta (v_recoleccion_pago; null = recolección anulada). */
function Pago({ retenida }: { retenida: boolean | null }) {
  if (retenida === null) return <Insignia tono="neutro">Recolección anulada</Insignia>;
  return retenida ? <Insignia tono="error">Pago retenido</Insignia> : <>No retenida</>;
}

/** A3 (parcial) · Alertas de las recolecciones: pendientes (las más antiguas primero) o todas. */
export default function Alertas() {
  useTitulo("Alertas");
  const id = useId();
  const sesion = useSesion();
  const [parametros, setParametros] = useSearchParams();
  const todas = parametros.get("todas") === "1";
  const tipo = parametros.get("tipo") || null;
  const recoleccion = parametros.get("recoleccion") || null;
  const recoleccionValida = recoleccion === null || UUID.test(recoleccion);
  const { carga, recargar, ponerDatos } = useCarga(
    () => (recoleccionValida ? listarAlertas({ todas, tipo, recoleccion_id: recoleccion }) : Promise.resolve([])),
    [todas, tipo, recoleccion],
  );
  const [aRevisar, setARevisar] = useState<Alerta | null>(null);

  function filtrar(clave: string, valor: string | null) {
    setParametros((p) => {
      const nuevos = new URLSearchParams(p);
      if (valor === null) nuevos.delete(clave);
      else nuevos.set(clave, valor);
      return nuevos;
    });
  }

  /** Quién revisó: el backend solo devuelve su id. El nombre se conoce únicamente si es el admin de esta sesión. */
  function revisor(usuarioId: number | null): string {
    if (usuarioId !== null && usuarioId === sesion?.usuario.id) return sesion.usuario.nombre_completo;
    return `el usuario n.º ${usuarioId}`;
  }

  // Pendientes: las más antiguas primero (orden del servidor). Todas: las más recientes primero.
  const filas = carga.estado === "listo" ? (todas ? [...carga.datos].reverse() : carga.datos) : [];
  const pendientes = filas.filter((a) => a.revisada_en === null);
  const porTipo = TIPOS_ALERTA
    .map((t) => ({ ...t, n: pendientes.filter((a) => a.tipo === t.valor).length }))
    .filter((t) => t.n > 0);

  return (
    <>
      <div className="encabezado">
        <h1>Alertas</h1>
      </div>

      <div className="filtros">
        <label className="casilla">
          <input type="checkbox" checked={todas} onChange={(e) => filtrar("todas", e.target.checked ? "1" : null)} />
          Mostrar también las revisadas
        </label>
        <div className="campo campo-en-linea">
          <label htmlFor={`${id}-tipo`}>Tipo</label>
          <select id={`${id}-tipo`} value={tipo ?? ""} onChange={(e) => filtrar("tipo", e.target.value || null)}>
            <option value="">Todos</option>
            {TIPOS_ALERTA.map((t) => <option key={t.valor} value={t.valor}>{t.texto}</option>)}
          </select>
        </div>
      </div>

      {recoleccion !== null && (
        <p className="aviso aviso-atencion">
          {recoleccionValida ? "Solo las alertas de una recolección." : "El filtro de recolección no es válido."}{" "}
          <button type="button" className="boton-enlace" onClick={() => filtrar("recoleccion", null)}>Ver todas</button>
        </p>
      )}

      {carga.estado === "cargando" && <p>Cargando alertas…</p>}
      {carga.estado === "error" && (
        <p className="aviso aviso-error" role="alert">
          {carga.mensaje}{" "}
          <button type="button" className="boton-enlace" onClick={recargar}>Reintentar</button>
        </p>
      )}
      {carga.estado === "listo" && (
        <>
          <p>
            <strong>{pendientes.length === 1 ? "1 pendiente" : `${pendientes.length} pendientes`}</strong>
            {" · "}
            {pendientes.filter((a) => retienePago(a.tipo)).length} retienen el pago
            {porTipo.length > 0 && (
              <span className="texto-suave"> ({porTipo.map((t) => `${t.texto}: ${t.n}`).join(", ")})</span>
            )}
          </p>
          {carga.datos.length >= MAX_ALERTAS && (
            <p className="aviso aviso-atencion">
              Se muestran las {MAX_ALERTAS} más antiguas{todas ? " (también las revisadas)" : ""}.
            </p>
          )}
          {filas.length === 0 ? (
            <p className="texto-suave">{todas ? "No hay alertas." : "No hay alertas pendientes."}</p>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Detalle</th>
                  <th>Recolección</th>
                  <th>Pago</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {textoTipoAlerta(a.tipo)}
                      {retienePago(a.tipo) && <> <Insignia tono="error">Retiene el pago</Insignia></>}
                    </td>
                    <td>{a.detalle ?? ""}</td>
                    <td>
                      {fechaHoraLima(a.registrada_en)}
                      {" · "}
                      <Link to={`/productores/${a.productor_id}`}>{a.productor}</Link> ({a.productor_codigo})
                      {" · "}{litros(a.litros)}
                      <br />
                      <span className="texto-suave">
                        {a.color_hex && <MuestraColor color={a.color_hex} />} {a.registrado_por_nombre}
                      </span>
                    </td>
                    <td><Pago retenida={a.recoleccion_retenida} /></td>
                    <td>
                      {a.revisada_en === null ? (
                        <button type="button" className="boton boton-secundario" onClick={() => setARevisar(a)}>
                          Revisar
                        </button>
                      ) : (
                        <>
                          Revisada por {revisor(a.revisada_por)} el {fechaHoraLima(a.revisada_en)}
                          {a.resolucion && <><br /><span className="texto-suave">{a.resolucion}</span></>}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {aRevisar !== null && carga.estado === "listo" && (
        <RevisarAlerta
          alerta={aRevisar}
          onCerrar={() => setARevisar(null)}
          onConflicto={recargar}
          onHecho={(revisada) => {
            // La fila queda a la vista como revisada; además, su pago puede haberse liberado
            ponerDatos(carga.datos.map((a) => (a.id === revisada.id ? revisada : a)));
            setARevisar(null);
          }}
        />
      )}
    </>
  );
}
