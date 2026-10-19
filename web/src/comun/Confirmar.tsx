import { useState, type ReactNode } from "react";

import { ErrorSesion } from "../api/cliente";
import { Modal } from "./Modal";
import { mensajeDeError } from "./useCarga";

type Props = {
  titulo: string;
  children: ReactNode;
  textoConfirmar: string;
  /** Acción que no se puede deshacer fácilmente: botón rojo. */
  peligro?: boolean;
  onConfirmar: () => Promise<void>;
  onCerrar: () => void;
};

/** Pide confirmación antes de una acción. Si falla, muestra el mensaje del servidor y deja reintentar. */
export function Confirmar({ titulo, children, textoConfirmar, peligro = false, onConfirmar, onCerrar }: Props) {
  const [ocupada, setOcupada] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmar() {
    setOcupada(true);
    setError(null);
    try {
      await onConfirmar();
    } catch (e) {
      if (e instanceof ErrorSesion) return;
      setError(mensajeDeError(e));
      setOcupada(false);
    }
  }

  return (
    <Modal
      titulo={titulo}
      onCerrar={onCerrar}
      ocupada={ocupada}
      acciones={
        <>
          <button type="button" className="boton boton-secundario" onClick={onCerrar} disabled={ocupada}>
            Cancelar
          </button>
          <button
            type="button"
            className={peligro ? "boton boton-peligro" : "boton boton-primario"}
            onClick={confirmar}
            disabled={ocupada}
          >
            {ocupada ? "Procesando…" : textoConfirmar}
          </button>
        </>
      }
    >
      {children}
      {error !== null && <p className="aviso aviso-error" role="alert">{error}</p>}
    </Modal>
  );
}
