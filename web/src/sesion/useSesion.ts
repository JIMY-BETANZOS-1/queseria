import { useSyncExternalStore } from "react";

import { sesionGuardada, suscribir, type Sesion } from "./almacen";

/** Sesión actual; la pantalla se vuelve a dibujar cuando se guarda o se cierra (401, vencimiento, Salir). */
export function useSesion(): Sesion | null {
  return useSyncExternalStore(suscribir, sesionGuardada);
}
