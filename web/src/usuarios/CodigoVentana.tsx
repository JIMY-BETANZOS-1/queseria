import { useRef, useState } from "react";

import type { CodigoActivacion } from "../api/tipos";
import { horaLima } from "../comun/formato";
import { Modal } from "../comun/Modal";

type Props = { nombre: string; codigo: CodigoActivacion; onCerrar: () => void };

/**
 * Muestra el código de activación UNA vez. El código solo vive en el estado del componente que lo pidió
 * (AccesoMovil) y se descarta al cerrar: no va a la URL, al almacenamiento, a la consola ni a ningún caché.
 */
export function CodigoVentana({ nombre, codigo, onCerrar }: Props) {
  const texto = useRef<HTMLParagraphElement>(null);
  const [copia, setCopia] = useState<"sin_copiar" | "copiado" | "seleccionado">("sin_copiar");

  async function copiar() {
    try {
      if (!navigator.clipboard) throw new Error("sin portapapeles");
      await navigator.clipboard.writeText(codigo.codigo);
      setCopia("copiado");
    } catch {
      // El navegador no deja copiar: queda seleccionado para copiarlo con Ctrl+C
      const seleccion = window.getSelection();
      if (seleccion && texto.current) seleccion.selectAllChildren(texto.current);
      setCopia("seleccionado");
    }
  }

  return (
    <Modal
      titulo={`Código de activación de ${nombre}`}
      onCerrar={onCerrar}
      acciones={
        <>
          <button type="button" className="boton boton-secundario" onClick={copiar}>Copiar</button>
          <button type="button" className="boton boton-primario" onClick={onCerrar}>Listo, ya lo anoté</button>
        </>
      }
    >
      <p ref={texto} className="codigo-activacion" aria-label="Código de activación">{codigo.codigo}</p>
      <ul className="lista-avisos">
        <li>Vence a las <strong>{horaLima(codigo.expira_en)}</strong> (hora de Lima) y sirve una sola vez.</li>
        <li>No se volverá a mostrar: si se pierde, genere otro.</li>
        <li>El usuario lo escribe en "Vincular celular" y ahí crea su propio PIN.</li>
      </ul>
      {copia === "copiado" && (
        <p className="aviso aviso-atencion" role="status">
          Copiado. Queda en el portapapeles de este computador hasta que copie otra cosa.
        </p>
      )}
      {copia === "seleccionado" && (
        <p className="aviso aviso-atencion" role="status">
          No se pudo copiar automáticamente: el código quedó seleccionado, cópielo con Ctrl+C. Si lo copia, queda
          en el portapapeles de este computador hasta que copie otra cosa.
        </p>
      )}
    </Modal>
  );
}
