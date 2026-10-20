import { useId, useState } from "react";

import { ErrorSesion } from "../../api/cliente";
import { anularRecoleccion } from "../../api/recolecciones";
import type { RecoleccionDetalle } from "../../api/tipos";
import { Campo } from "../../comun/Campo";
import { fechaHoraLima, litros } from "../../comun/formato";
import { Modal } from "../../comun/Modal";
import { mensajeDeError } from "../../comun/useCarga";

type Props = {
  recoleccion: RecoleccionDetalle;
  /** Anulada: la recolección como quedó en el servidor. */
  onHecho: (anulada: RecoleccionDetalle) => void;
  onCerrar: () => void;
};

/**
 * Anular con motivo. Los textos describen lo que hacen el backend (routers/recolecciones.py: no se borra, no hay
 * forma de deshacer) y la base: v_recoleccion_pago, v_acopiador_mes y v_leche_jornada excluyen las anuladas;
 * trg_recoleccion_sancion_rev levanta la sanción que originó una alterada; nada toca lote_leche ni las alertas.
 * La app (LineasMiDia) muestra la anulada en rojo y no la suma. Una liquidada la rechaza la base (parche 001).
 */
export function AnularRecoleccion({ recoleccion: r, onHecho, onCerrar }: Props) {
  const id = useId();
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [general, setGeneral] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState(false);

  async function anular() {
    const texto = motivo.trim();
    setGeneral(null);
    if (texto === "") {
      setError("Escriba el motivo");
      return;
    }
    setError(undefined);
    setOcupada(true);
    try {
      onHecho(await anularRecoleccion(r.recoleccion_id, texto));
    } catch (e) {
      if (e instanceof ErrorSesion) return;
      setGeneral(mensajeDeError(e));
      setOcupada(false);
    }
  }

  return (
    <Modal
      titulo="Anular recolección"
      onCerrar={onCerrar}
      ocupada={ocupada}
      acciones={
        <>
          <button type="button" className="boton boton-secundario" onClick={onCerrar} disabled={ocupada}>Cancelar</button>
          <button type="button" className="boton boton-peligro" onClick={anular} disabled={ocupada}>
            {ocupada ? "Procesando…" : "Anular recolección"}
          </button>
        </>
      }
    >
      <p className="texto-suave">
        {r.productor} <span className="codigo">({r.productor_codigo})</span> · {litros(r.litros)} · {fechaHoraLima(r.registrada_en)}
        {" "}· registró {r.registrado_por_nombre}
      </p>
      <ul className="lista-avisos">
        <li>No se borra: queda anulada con su motivo, la fecha y quién la anuló. No se puede deshacer.</li>
        <li>No se paga, y deja de contar para la comisión del acopiador y en la leche de su jornada.</li>
        <li>Si la leche de ese día ya se usó en un lote, el lote no cambia.</li>
        {r.estado_calidad === "alterado" && (
          <li>Si esta leche originó una sanción del productor, la sanción se levanta.</li>
        )}
        {r.tipo_productor === "de_ruta" && (
          <li>
            En el celular de {r.registrado_por_nombre}, "Mi día" la mostrará como Anulada y no la sumará, cuando tenga
            señal.
          </li>
        )}
        {r.alertas_pendientes > 0 && (
          <li>
            {r.alertas_pendientes === 1
              ? "Su alerta sin revisar sigue pendiente: revísela después."
              : `Sus ${r.alertas_pendientes} alertas sin revisar siguen pendientes: revíselas después.`}
          </li>
        )}
      </ul>
      <Campo id={`${id}-motivo`} etiqueta="Motivo" error={error} deshabilitado={ocupada}>
        {(p) => <textarea {...p} rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
      </Campo>
      {general !== null && <p className="aviso aviso-error" role="alert">{general}</p>}
    </Modal>
  );
}
