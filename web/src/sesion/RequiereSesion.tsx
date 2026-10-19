import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { motivoCierre } from "./almacen";
import { useSesion } from "./useSesion";

/**
 * Protege las pantallas del panel. Sin sesión lleva a Entrar con ?volver= para regresar al mismo lugar;
 * si el admin salió a propósito ("Salir"), va a Entrar sin volver.
 */
export function RequiereSesion({ children }: { children: ReactNode }) {
  const sesion = useSesion();
  const { pathname, search } = useLocation();

  if (sesion === null) {
    const destino = motivoCierre() === "salida"
      ? "/entrar"
      : `/entrar?volver=${encodeURIComponent(pathname + search)}`;
    return <Navigate to={destino} replace />;
  }
  return children;
}
