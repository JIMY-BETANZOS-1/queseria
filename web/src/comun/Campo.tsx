import type { ReactNode } from "react";

/** Atributos que Campo pasa al control (input o select) para enlazarlo con su etiqueta, ayuda y error. */
export type PropsControl = {
  id: string;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
  disabled: boolean;
};

type Props = {
  /** id del control; la ayuda y el error usan `${id}-ayuda` y `${id}-error`. */
  id: string;
  etiqueta: string;
  error?: string;
  ayuda?: string;
  deshabilitado?: boolean;
  children: (props: PropsControl) => ReactNode;
};

/**
 * Campo de formulario: etiqueta, control, ayuda y error. El error va FUERA de la etiqueta (si no, el lector
 * de pantalla anunciaría "Correo Escriba su correo") y se enlaza al control con aria-describedby.
 */
export function Campo({ id, etiqueta, error, ayuda, deshabilitado = false, children }: Props) {
  const descripcion = [error ? `${id}-error` : null, ayuda ? `${id}-ayuda` : null].filter(Boolean).join(" ");
  return (
    <div className="campo">
      <label htmlFor={id}>{etiqueta}</label>
      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": descripcion || undefined,
        disabled: deshabilitado,
      })}
      {ayuda && <span id={`${id}-ayuda`} className="campo-ayuda">{ayuda}</span>}
      {error && <span id={`${id}-error`} className="campo-error">{error}</span>}
    </div>
  );
}
