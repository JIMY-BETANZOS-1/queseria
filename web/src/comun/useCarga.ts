import { useCallback, useEffect, useState } from "react";

import { ErrorApi, ErrorSesion } from "../api/cliente";

export type Carga<T> =
  | { estado: "cargando" }
  | { estado: "error"; mensaje: string }
  | { estado: "listo"; datos: T };

/** Mensaje para mostrar de un error de la API (o genérico si no es de la API). */
export function mensajeDeError(e: unknown): string {
  return e instanceof ErrorApi ? e.message : "Ocurrió un error inesperado. Intente de nuevo.";
}

/**
 * Carga datos de la API al abrir la pantalla (y cuando cambian `claves`). Ante ErrorSesion no muestra nada:
 * RequiereSesion ya lleva a Entrar. `recargar` vuelve a pedir sin pasar por "cargando" si ya había datos.
 */
export function useCarga<T>(cargar: () => Promise<T>, claves: readonly unknown[]) {
  const [carga, setCarga] = useState<Carga<T>>({ estado: "cargando" });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let vigente = true;
    cargar()
      .then((datos) => vigente && setCarga({ estado: "listo", datos }))
      .catch((e: unknown) => {
        if (!vigente || e instanceof ErrorSesion) return;
        setCarga({ estado: "error", mensaje: mensajeDeError(e) });
      });
    return () => {
      vigente = false;
    };
    // `cargar` es una función nueva en cada render: lo que decide cuándo volver a pedir son `claves`
  }, [...claves, version]);

  const recargar = useCallback(() => setVersion((v) => v + 1), []);
  /** Reemplaza los datos con los que devolvió una escritura (sin volver a pedirlos). */
  const ponerDatos = useCallback((datos: T) => setCarga({ estado: "listo", datos }), []);

  return { carga, recargar, ponerDatos };
}
