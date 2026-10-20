import { useEffect, useState } from "react";

import { API_URL } from "../api/config";
import { consultarSalud, type Salud } from "../api/salud";

type Estado = { tipo: "cargando" } | { tipo: "ok"; salud: Salud } | { tipo: "error"; mensaje: string };

/**
 * Estado de la API, al pie del panel. En el build de producción solo se ve si hay un problema: "conectada" y el
 * nombre de la base son datos para desarrollo.
 */
export function EstadoApi() {
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });

  useEffect(() => {
    let vigente = true;
    consultarSalud()
      .then((salud) => vigente && setEstado({ tipo: "ok", salud }))
      .catch(() => vigente && setEstado({ tipo: "error", mensaje: `No se pudo conectar con la API (${API_URL})` }));
    return () => {
      vigente = false;
    };
  }, []);

  if (estado.tipo === "error") return <span className="error">{estado.mensaje}</span>;
  if (import.meta.env.PROD) return null;
  if (estado.tipo === "cargando") return <span className="texto-suave">Conectando con la API…</span>;
  return (
    <span className="ok">
      API conectada · base <strong>{estado.salud.base}</strong>
    </span>
  );
}
