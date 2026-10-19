import { useEffect, useState } from "react";

import { API_URL } from "../api/config";
import { consultarSalud, type Salud } from "../api/salud";
import { useTitulo } from "../comun/useTitulo";
import { useSesion } from "../sesion/useSesion";

type Estado = { tipo: "cargando" } | { tipo: "ok"; salud: Salud } | { tipo: "error"; mensaje: string };

/** Inicio del panel: saludo y estado de la API. */
export default function Inicio() {
  useTitulo("Inicio");
  const sesion = useSesion();
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

  return (
    <>
      <h1>Bienvenido{sesion ? `, ${sesion.usuario.nombre_completo}` : ""}</h1>
      {estado.tipo === "cargando" && <p>Conectando con la API…</p>}
      {estado.tipo === "ok" && (
        <p className="aviso aviso-ok">
          API conectada · base <strong>{estado.salud.base}</strong>
        </p>
      )}
      {estado.tipo === "error" && <p className="aviso aviso-error">{estado.mensaje}</p>}
    </>
  );
}
