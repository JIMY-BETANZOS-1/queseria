import { useEffect } from "react";

/** Título de la pestaña del navegador: "<pantalla> · Quesería Huata". */
export function useTitulo(pantalla: string): void {
  useEffect(() => {
    document.title = `${pantalla} · Quesería Huata`;
  }, [pantalla]);
}
