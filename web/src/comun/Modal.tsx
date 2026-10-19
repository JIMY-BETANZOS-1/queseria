import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

type Props = {
  titulo: string;
  children: ReactNode;
  /** Botones del pie. */
  acciones: ReactNode;
  onCerrar: () => void;
  /** Mientras se guarda algo, Esc no cierra. */
  ocupada?: boolean;
};

const ENFOCABLES = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Ventana sobre la pantalla (role="dialog"). Al abrir pone el foco en el primer elemento, Tab no sale de ella,
 * Esc la cierra y al cerrarse el foco vuelve a donde estaba. Hacer clic fuera NO la cierra (no se pierde lo
 * que muestra, como un código de activación).
 */
export function Modal({ titulo, children, acciones, onCerrar, ocupada = false }: Props) {
  const id = useId();
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    const primero = caja.current?.querySelector<HTMLElement>(ENFOCABLES);
    (primero ?? caja.current)?.focus();
    return () => anterior?.focus();
  }, []);

  function teclas(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape" && !ocupada) {
      e.stopPropagation();
      onCerrar();
      return;
    }
    if (e.key !== "Tab" || !caja.current) return;
    const enfocables = Array.from(caja.current.querySelectorAll<HTMLElement>(ENFOCABLES));
    const primero = enfocables[0];
    const ultimo = enfocables[enfocables.length - 1];
    if (!primero || !ultimo) return;
    if (e.shiftKey && document.activeElement === primero) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primero.focus();
    }
  }

  return (
    <div className="modal-fondo">
      <div
        ref={caja}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-titulo`}
        tabIndex={-1}
        onKeyDown={teclas}
      >
        <h2 id={`${id}-titulo`} className="modal-titulo">{titulo}</h2>
        <div className="modal-cuerpo">{children}</div>
        <div className="modal-acciones">{acciones}</div>
      </div>
    </div>
  );
}
