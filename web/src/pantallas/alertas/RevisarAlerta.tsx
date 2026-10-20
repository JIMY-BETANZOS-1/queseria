import { useId, useState } from "react";

import { ErrorApi, ErrorSesion } from "../../api/cliente";
import { revisarAlerta } from "../../api/alertas";
import type { Alerta } from "../../api/tipos";
import { Campo } from "../../comun/Campo";
import { fechaHoraLima, litros } from "../../comun/formato";
import { Modal } from "../../comun/Modal";
import { mensajeDeError } from "../../comun/useCarga";
import { retienePago, textoTipoAlerta } from "./tiposAlerta";

type Props = {
  alerta: Alerta;
  /** Revisada: la alerta como quedó en el servidor. */
  onHecho: (revisada: Alerta) => void;
  /** Otro admin ya la revisó (409): recargar la lista. La ventana sigue abierta con el mensaje. */
  onConflicto: () => void;
  onCerrar: () => void;
};

/**
 * Revisar una alerta con su resolución. Los textos describen lo que hacen el backend (routers/alertas.py: no
 * hay forma de deshacer; 409 si ya estaba revisada) y la base (v_recoleccion_pago: solo productor_bloqueado y
 * firma_invalida retienen, junto con "productor no aprobado"; pagable = revisada por el analista y no retenida;
 * fn_en_sancion cuenta el bloqueo como sanción de precio; revisar no toca sancion_productor).
 */
export function RevisarAlerta({ alerta, onHecho, onConflicto, onCerrar }: Props) {
  const id = useId();
  const [resolucion, setResolucion] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [general, setGeneral] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState(false);
  const retiene = retienePago(alerta.tipo);

  async function guardar() {
    const texto = resolucion.trim();
    setGeneral(null);
    if (texto === "") {
      setError("Escriba la resolución");
      return;
    }
    setError(undefined);
    setOcupada(true);
    try {
      onHecho(await revisarAlerta(alerta.id, texto));
    } catch (e) {
      if (e instanceof ErrorSesion) return;
      setGeneral(mensajeDeError(e));
      setOcupada(false);
      if (e instanceof ErrorApi && e.status === 409) onConflicto();
    }
  }

  return (
    <Modal
      titulo={`Revisar alerta: ${textoTipoAlerta(alerta.tipo)}`}
      onCerrar={onCerrar}
      ocupada={ocupada}
      acciones={
        <>
          <button type="button" className="boton boton-secundario" onClick={onCerrar} disabled={ocupada}>Cancelar</button>
          <button type="button" className="boton boton-primario" onClick={guardar} disabled={ocupada}>
            {ocupada ? "Procesando…" : "Marcar como revisada"}
          </button>
        </>
      }
    >
      {alerta.detalle && <p>{alerta.detalle}</p>}
      <p className="texto-suave">
        {alerta.productor} ({alerta.productor_codigo}) · {litros(alerta.litros)} · {fechaHoraLima(alerta.registrada_en)}
        {" "}· registró {alerta.registrado_por_nombre}
      </p>
      <ul className="lista-avisos">
        <li>Queda como revisada, con su resolución y la fecha. No se puede deshacer.</li>
        {retiene ? (
          <>
            <li>
              Libera el pago de esta recolección, salvo que su productor no esté aprobado o tenga otra alerta que
              retenga sin revisar. Solo se paga cuando el analista la haya revisado.
            </li>
            {alerta.tipo === "productor_bloqueado" && (
              <li>No cambia el bloqueo del productor. Esa leche se paga a precio de sanción.</li>
            )}
            <li>Si esa leche no debe pagarse, anule la recolección en lugar de revisar esta alerta.</li>
          </>
        ) : (
          <li>Esta alerta no retiene el pago: revisarla solo deja constancia.</li>
        )}
        {alerta.tipo === "posible_duplicado" && (
          <li>Si de verdad está duplicada, anule una de las dos recolecciones.</li>
        )}
      </ul>
      <Campo id={`${id}-resolucion`} etiqueta="Resolución" error={error} deshabilitado={ocupada}>
        {(p) => <textarea {...p} rows={3} value={resolucion} onChange={(e) => setResolucion(e.target.value)} />}
      </Campo>
      {general !== null && <p className="aviso aviso-error" role="alert">{general}</p>}
    </Modal>
  );
}
