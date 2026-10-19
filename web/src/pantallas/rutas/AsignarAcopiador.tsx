import { useId, useState } from "react";
import { Link } from "react-router-dom";

import { ErrorSesion } from "../../api/cliente";
import { asignarAcopiador } from "../../api/rutas";
import type { Asignacion, Ruta } from "../../api/tipos";
import { listarAcopiadores } from "../../api/usuarios";
import { Campo } from "../../comun/Campo";
import { fecha, hoyLima } from "../../comun/formato";
import { Modal } from "../../comun/Modal";
import { mensajeDeError, useCarga } from "../../comun/useCarga";

/**
 * Fecha mínima de "Desde": el inicio de la asignación vigente (el servidor la cierra con vigente_hasta = desde,
 * y ck_ruta_acopiador_fechas no deja que sea anterior). Sin asignación vigente, el cierre de la última, para
 * que el historial no se superponga.
 */
export function minimoDesde(historial: Asignacion[]): { fecha: string; motivo: string } | null {
  const vigente = historial.find((a) => a.vigente_hasta === null);
  if (vigente) return { fecha: vigente.vigente_desde, motivo: "el inicio de la asignación vigente" };
  const cierres = historial.map((a) => a.vigente_hasta).filter((h): h is string => h !== null).sort();
  const ultimo = cierres[cierres.length - 1];
  return ultimo ? { fecha: ultimo, motivo: "el cierre de la última asignación" } : null;
}

type Props = {
  ruta: Ruta;
  historial: Asignacion[];
  /** Se guardó la asignación: recargar la ruta y su historial. */
  onHecho: () => void;
  onCerrar: () => void;
};

/**
 * Asignar o cambiar el acopiador de una ruta. Los textos describen lo que hacen el pull (solo mira la
 * asignación abierta y la ruta activa, no las fechas: routers/sync.py), la app (SyncDao.aplicarPull borra solo
 * lo ya sincronizado) y el push (no revisa la ruta). La comisión va por quien registró (v_acopiador_mes).
 */
export function AsignarAcopiador({ ruta, historial, onHecho, onCerrar }: Props) {
  const id = useId();
  const acopiadores = useCarga(listarAcopiadores, []);
  const [hoy] = useState(() => hoyLima());
  const minimo = minimoDesde(historial);
  const [acopiadorId, setAcopiadorId] = useState("");
  const [desde, setDesde] = useState(hoy);
  const [errores, setErrores] = useState<{ acopiador?: string; desde?: string }>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState(false);

  const anterior = ruta.acopiador_id != null ? ruta.acopiador : null;
  const opciones = acopiadores.carga.estado === "listo"
    ? acopiadores.carga.datos.filter((a) => a.activo && a.id !== ruta.acopiador_id)
    : [];
  const elegido = opciones.find((a) => String(a.id) === acopiadorId);
  const sinRango = minimo !== null && minimo.fecha > hoy;   // la vigente empieza después de hoy

  function validar() {
    const e: typeof errores = {};
    if (!elegido) e.acopiador = "Elija un acopiador";
    if (desde === "") e.desde = "Elija la fecha";
    else if (desde > hoy) e.desde = `No puede ser posterior a hoy (${fecha(hoy)})`;
    else if (minimo && desde < minimo.fecha) e.desde = `No puede ser anterior al ${fecha(minimo.fecha)}, ${minimo.motivo}`;
    return e;
  }

  async function guardar() {
    const locales = validar();
    setErrores(locales);
    setGeneral(null);
    if (Object.keys(locales).length > 0 || !elegido) return;
    setOcupada(true);
    try {
      await asignarAcopiador(ruta.id, { acopiador_id: elegido.id, desde });
      onHecho();
    } catch (e) {
      if (e instanceof ErrorSesion) return;
      setGeneral(mensajeDeError(e));
      setOcupada(false);
    }
  }

  const nuevo = elegido?.nombre_completo ?? "El acopiador elegido";
  return (
    <Modal
      titulo={anterior ? "Cambiar acopiador" : "Asignar acopiador"}
      onCerrar={onCerrar}
      ocupada={ocupada}
      acciones={
        <>
          <button type="button" className="boton boton-secundario" onClick={onCerrar} disabled={ocupada}>
            Cancelar
          </button>
          <button type="button" className="boton boton-primario" onClick={guardar}
                  disabled={ocupada || sinRango || opciones.length === 0}>
            {ocupada ? "Procesando…" : anterior ? "Cambiar" : "Asignar"}
          </button>
        </>
      }
    >
      {acopiadores.carga.estado === "cargando" && <p>Cargando acopiadores…</p>}
      {acopiadores.carga.estado === "error" && (
        <p className="aviso aviso-error" role="alert">
          {acopiadores.carga.mensaje}{" "}
          <button type="button" className="boton-enlace" onClick={acopiadores.recargar}>Reintentar</button>
        </p>
      )}
      {acopiadores.carga.estado === "listo" && opciones.length === 0 && (
        <p>
          No hay {anterior ? "otros acopiadores activos" : "acopiadores activos"}.{" "}
          <Link to="/acopiadores/nuevo">Nuevo acopiador</Link>
        </p>
      )}
      {sinRango && minimo && (
        <p className="aviso aviso-atencion">
          La asignación vigente empieza el {fecha(minimo.fecha)}, después de hoy: no se puede cambiar antes de esa fecha.
        </p>
      )}
      {opciones.length > 0 && !sinRango && (
        <>
          <Campo id={`${id}-acopiador`} etiqueta="Acopiador" error={errores.acopiador} deshabilitado={ocupada}>
            {(p) => (
              <select {...p} value={acopiadorId} onChange={(e) => setAcopiadorId(e.target.value)}>
                <option value="">Elija…</option>
                {opciones.map((a) => <option key={a.id} value={a.id}>{a.nombre_completo}</option>)}
              </select>
            )}
          </Campo>
          <Campo id={`${id}-desde`} etiqueta="Desde" error={errores.desde} deshabilitado={ocupada}
                 ayuda="La fecha queda en el historial; el cambio rige desde que se guarda.">
            {(p) => (
              <input {...p} type="date" min={minimo?.fecha} max={hoy} value={desde}
                     onChange={(e) => setDesde(e.target.value)} />
            )}
          </Campo>
          <ul className="lista-avisos">
            {ruta.activa ? (
              <li>{nuevo} recibe esta ruta y sus productores en su celular en su próxima sincronización.</li>
            ) : (
              <li>La ruta está inactiva: no aparecerá en ningún celular hasta reactivarla.</li>
            )}
            {anterior && (
              <li>
                {ruta.activa ? `${anterior} deja de verlos en la suya.` : `${anterior} deja de tenerla asignada.`}{" "}
                Lo que tenga sin enviar se sube igual y queda a su nombre.
              </li>
            )}
          </ul>
        </>
      )}
      {general !== null && <p className="aviso aviso-error" role="alert">{general}</p>}
    </Modal>
  );
}
