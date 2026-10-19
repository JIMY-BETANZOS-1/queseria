import { useEffect, useState } from "react";

import { API_URL } from "./api/config";
import { consultarSalud, type Salud } from "./api/salud";

type Estado = { tipo: "cargando" } | { tipo: "ok"; salud: Salud } | { tipo: "error"; mensaje: string };

/** Paso 1: esqueleto del panel. Muestra si la API responde (y con ello que el CORS está bien configurado). */
export default function App() {
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
    <main className="pagina">
      <h1>Quesería Huata · Administración</h1>
      {estado.tipo === "cargando" && <p>Conectando con la API…</p>}
      {estado.tipo === "ok" && (
        <p className="aviso aviso-ok">
          API conectada · base <strong>{estado.salud.base}</strong>
        </p>
      )}
      {estado.tipo === "error" && <p className="aviso aviso-error">{estado.mensaje}</p>}
    </main>
  );
}
