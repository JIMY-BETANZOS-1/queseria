import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * Aviso de "recién creado" en el detalle de un usuario o una ruta: se muestra si se llegó desde "Nuevo" (state
 * { creado: true }) y se apaga con la primera acción, porque después contradiría el estado actual.
 * Devuelve [mostrar, olvidar]; olvidar también limpia el historial, así con F5 no vuelve.
 */
export function useAvisoCreado(): [boolean, () => void] {
  const ubicacion = useLocation();
  const navegar = useNavigate();
  const [mostrar, setMostrar] = useState((ubicacion.state as { creado?: boolean } | null)?.creado === true);

  function olvidar() {
    if (!mostrar) return;
    setMostrar(false);
    navegar(ubicacion.pathname, { replace: true, state: null });
  }

  return [mostrar, olvidar];
}
