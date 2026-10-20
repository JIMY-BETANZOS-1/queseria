import { useEffect, useId, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { listarParametros } from "../../api/configuracion";
import { MAX_RECOLECCIONES, recoleccionesDelDia } from "../../api/recolecciones";
import type { RecoleccionDetalle } from "../../api/tipos";
import { Estado, FiltroBotones, Vacio } from "../../comun/Estado";
import { fecha as fechaTexto, fechaHoraLima, horaLima, hoyLima, litros, sumarDias } from "../../comun/formato";
import { Modal } from "../../comun/Modal";
import { MuestraColor } from "../../comun/MuestraColor";
import { useCarga } from "../../comun/useCarga";
import { useTitulo } from "../../comun/useTitulo";
import { estadoPago } from "../productores/EstadoPago";
import { AnularRecoleccion } from "./AnularRecoleccion";
import { MapaEntregas, metros } from "./MapaEntregas";
import { ResumenPorPersona } from "./ResumenPorPersona";
import { textoUbicacion } from "./ubicacion";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

type Filtro = "todas" | "por_revisar" | "con_alertas" | "anuladas";
const FILTROS: { valor: Filtro; texto: string; cumple: (r: RecoleccionDetalle) => boolean }[] = [
  { valor: "todas", texto: "Todas", cumple: () => true },
  { valor: "por_revisar", texto: "Por revisar", cumple: (r) => r.anulada_en === null && !r.revisada },
  { valor: "con_alertas", texto: "Con alertas", cumple: (r) => r.alertas_pendientes > 0 },
  { valor: "anuladas", texto: "Anuladas", cumple: (r) => r.anulada_en !== null },
];

/** A3 (parcial) · Recolecciones de un día (hora de Lima), resumen por persona y anulación con motivo. */
export default function RecoleccionesDia() {
  useTitulo("Entregas del día");
  const id = useId();
  const [hoy] = useState(() => hoyLima());
  const [parametros, setParametros] = useSearchParams();
  const pedida = parametros.get("fecha");
  const fechaValida = pedida === null || (FECHA.test(pedida) && pedida <= hoy);
  const fecha = pedida !== null && fechaValida ? pedida : hoy;
  const persona = Number(parametros.get("persona")) || null;
  const destacada = parametros.get("recoleccion");
  const { carga, recargar, ponerDatos } = useCarga(() => recoleccionesDelDia(fecha), [fecha]);
  const [aAnular, setAAnular] = useState<RecoleccionDetalle | null>(null);
  const [recienAnulada, setRecienAnulada] = useState<RecoleccionDetalle | null>(null);
  const filaDestacada = useRef<HTMLTableRowElement>(null);
  const vista = parametros.get("vista") === "mapa" ? "mapa" : "lista";
  const filtro = FILTROS.find((f) => f.valor === parametros.get("filtro"))?.valor ?? "todas";
  const [enMapa, setEnMapa] = useState<RecoleccionDetalle | null>(null);
  // Umbral de "lejos" para resaltar en el mapa: el mismo parámetro que usa la base para su alerta
  const parametrosBase = useCarga(listarParametros, []);
  const umbralTexto = parametrosBase.carga.estado === "listo"
    ? parametrosBase.carga.datos.find((x) => x.clave === "max_distancia_productor_m")?.valor : undefined;
  const umbral = umbralTexto !== undefined && Number.isFinite(Number(umbralTexto)) ? Number(umbralTexto) : null;

  function cambiar(valores: Record<string, string | null>) {
    setRecienAnulada(null);
    setParametros((p) => {
      const nuevos = new URLSearchParams(p);
      for (const [clave, valor] of Object.entries(valores)) {
        if (valor === null) nuevos.delete(clave);
        else nuevos.set(clave, valor);
      }
      return nuevos;
    });
  }

  // Al llegar desde una alerta: llevar la vista y el foco a su recolección
  const listo = carga.estado === "listo";
  useEffect(() => {
    if (!listo || !filaDestacada.current) return;
    filaDestacada.current.scrollIntoView?.({ block: "center" });
    filaDestacada.current.focus();
  }, [listo, destacada]);

  // Llegando desde una alerta no se filtra por persona: la fila buscada siempre se ve
  const todas = carga.estado === "listo" ? carga.datos : [];
  const dePersona = destacada === null && persona !== null ? todas.filter((r) => r.registrado_por === persona) : todas;
  const cumple = FILTROS.find((f) => f.valor === filtro)!.cumple;
  const filas = destacada === null ? dePersona.filter(cumple) : dePersona;

  return (
    <>
      <div className="encabezado">
        <h1>Entregas del día</h1>
      </div>

      <div className="filtros">
        <button type="button" className="boton boton-secundario"
                onClick={() => cambiar({ fecha: sumarDias(fecha, -1), recoleccion: null })}>
          Día anterior
        </button>
        <div className="campo campo-en-linea">
          <label htmlFor={`${id}-fecha`}>Fecha</label>
          <input id={`${id}-fecha`} type="date" max={hoy} value={fecha}
                 onChange={(e) => FECHA.test(e.target.value) && e.target.value <= hoy
                   && cambiar({ fecha: e.target.value, recoleccion: null })} />
        </div>
        <button type="button" className="boton boton-secundario" disabled={fecha >= hoy}
                onClick={() => cambiar({ fecha: sumarDias(fecha, 1), recoleccion: null })}>
          Día siguiente
        </button>
      </div>

      {!fechaValida && (
        <p className="aviso aviso-atencion">La fecha pedida no es válida o es futura: se muestra hoy ({fechaTexto(hoy)}).</p>
      )}

      {carga.estado === "cargando" && <p>Cargando recolecciones…</p>}
      {carga.estado === "error" && (
        <p className="aviso aviso-error" role="alert">
          {carga.mensaje}{" "}
          <button type="button" className="boton-enlace" onClick={recargar}>Reintentar</button>
        </p>
      )}
      {carga.estado === "listo" && (todas.length === 0 ? (
        <Vacio icono="recolecciones">No hubo recolecciones el {fechaTexto(fecha)}.</Vacio>
      ) : (
        <>
          {todas.length >= MAX_RECOLECCIONES && (
            <p className="aviso aviso-atencion">Se muestran las primeras {MAX_RECOLECCIONES} del día.</p>
          )}

          <section className="seccion" aria-labelledby={`${id}-resumen`}>
            <h2 id={`${id}-resumen`}>Resumen por persona</h2>
            <ResumenPorPersona filas={todas} seleccionada={destacada === null ? persona : null}
                               onElegir={(p) => cambiar({ persona: p === null ? null : String(p), recoleccion: null })} />
          </section>

          {recienAnulada !== null && (
            <p className="aviso aviso-ok" role="status">
              Recolección anulada.
              {recienAnulada.alertas_pendientes > 0 && (
                <>
                  {" "}Tiene {recienAnulada.alertas_pendientes === 1 ? "1 alerta" : `${recienAnulada.alertas_pendientes} alertas`} sin
                  revisar:{" "}
                  <Link to={`/alertas?recoleccion=${recienAnulada.recoleccion_id}`}>revisarlas</Link>.
                </>
              )}
            </p>
          )}

          <section className="seccion" aria-labelledby={`${id}-detalle`}>
            <div className="encabezado-seccion">
              <h2 id={`${id}-detalle`}>Entregas</h2>
              <FiltroBotones etiqueta="Vista" valor={vista}
                             opciones={[{ valor: "lista", texto: "Lista" }, { valor: "mapa", texto: "Mapa" }]}
                             onCambiar={(v) => cambiar({ vista: v === "mapa" ? "mapa" : null })} />
            </div>
            {destacada === null && (
              <FiltroBotones etiqueta="Filtrar entregas" valor={filtro}
                             opciones={FILTROS.map((f) => ({ valor: f.valor, texto: f.texto, cuenta: dePersona.filter(f.cumple).length }))}
                             onCambiar={(v) => cambiar({ filtro: v === "todas" ? null : v })} />
            )}
            {destacada !== null && (
              <p className="aviso aviso-atencion">
                Se destaca la recolección de la alerta.{" "}
                <button type="button" className="boton-enlace" onClick={() => cambiar({ recoleccion: null })}>
                  Quitar
                </button>
              </p>
            )}
            {filas.length === 0 ? (
              <Vacio icono="recolecciones">Ninguna entrega con ese filtro.</Vacio>
            ) : vista === "mapa" ? (
              <MapaEntregas filas={filas.filter((r) => r.anulada_en === null)} umbral={umbral} />
            ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Hora</th>
                  <th>Productor</th>
                  <th>Ruta</th>
                  <th>Registró</th>
                  <th className="numero">Litros</th>
                  <th>Calidad</th>
                  <th>Ubicación</th>
                  <th className="numero">Alertas</th>
                  <th>Pago</th>
                  <th><span className="solo-lector">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {filas.map((r) => {
                  const esDestacada = r.recoleccion_id === destacada;
                  return (
                    <tr key={r.recoleccion_id} ref={esDestacada ? filaDestacada : undefined}
                        aria-current={esDestacada ? "true" : undefined} tabIndex={esDestacada ? -1 : undefined}
                        className={r.anulada_en !== null ? "anulada" : undefined}>
                      <td>{horaLima(r.registrada_en)}</td>
                      <td>
                        <Link to={`/productores/${r.productor_id}`}>{r.productor}</Link> <span className="codigo">({r.productor_codigo})</span>
                        {r.productor_pendiente && <> <Estado tono="atencion">Pendiente de aprobación</Estado></>}
                        {r.observacion && <><br /><span className="texto-suave">{r.observacion}</span></>}
                      </td>
                      <td>{r.ruta ?? "Externo"}</td>
                      <td>{r.color_hex && <MuestraColor color={r.color_hex} />} {r.registrado_por_nombre}</td>
                      <td className="numero">{litros(r.litros)}</td>
                      <td>
                        {r.estado_calidad === "alterado" ? <Estado tono="error">Alterada</Estado>
                          : r.revisada ? <Estado tono="ok">Normal</Estado> : <Estado tono="atencion">Por revisar</Estado>}
                      </td>
                      <td>
                        <span>{textoUbicacion(r)}</span>
                        {r.distancia_ref_m !== null && r.distancia_ref_m > 0 && (
                          <span className={umbral !== null && r.distancia_ref_m > umbral ? "distancia lejos" : "distancia"}>
                            {" "}· a {metros(r.distancia_ref_m)}
                          </span>
                        )}
                        {r.ubicacion_simulada && <> <Estado tono="error">Simulada</Estado></>}
                      </td>
                      <td className="numero">
                        {r.alertas_pendientes > 0 && (
                          <Link to={`/alertas?recoleccion=${r.recoleccion_id}`}
                                aria-label={`${r.alertas_pendientes} sin revisar: ver alertas`}>
                            {r.alertas_pendientes}
                          </Link>
                        )}
                      </td>
                      <td>
                        <Estado tono={estadoPago(r).tono}>{estadoPago(r).texto}</Estado>
                        {/* El backend solo devuelve anulada_en: ni quién la anuló ni el motivo (v_recoleccion_detalle) */}
                        {r.anulada_en !== null && <><br /><span className="texto-suave">el {fechaHoraLima(r.anulada_en)}</span></>}
                      </td>
                      <td className="acciones">
                        {(r.latitud !== null || r.latitud_ref !== null) && (
                          <button type="button" className="boton boton-secundario"
                                  aria-label={`Ver en el mapa la entrega de ${r.productor} de las ${horaLima(r.registrada_en)}`}
                                  onClick={() => setEnMapa(r)}>
                            Mapa
                          </button>
                        )}
                        {r.anulada_en === null && (r.liquidada
                          ? <span className="texto-suave">Liquidada: no se anula</span>
                          : (
                            <button type="button" className="boton boton-peligro-suave" onClick={() => setAAnular(r)}>
                              Anular
                            </button>
                          ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            )}
          </section>
        </>
      ))}

      {enMapa !== null && (
        <Modal titulo={`Entrega de ${enMapa.productor} · ${horaLima(enMapa.registrada_en)}`} onCerrar={() => setEnMapa(null)}
               acciones={<button type="button" className="boton boton-secundario" onClick={() => setEnMapa(null)}>Cerrar</button>}>
          <MapaEntregas filas={[enMapa]} umbral={umbral} />
        </Modal>
      )}

      {aAnular !== null && carga.estado === "listo" && (
        <AnularRecoleccion
          recoleccion={aAnular}
          onCerrar={() => setAAnular(null)}
          onHecho={(anulada) => {
            ponerDatos(carga.datos.map((r) => (r.recoleccion_id === anulada.recoleccion_id ? anulada : r)));
            setAAnular(null);
            setRecienAnulada(anulada);
          }}
        />
      )}
    </>
  );
}
