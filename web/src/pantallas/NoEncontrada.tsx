import { Link } from "react-router-dom";

import { useTitulo } from "../comun/useTitulo";

export default function NoEncontrada() {
  useTitulo("Página no encontrada");
  return (
    <>
      <h1>Página no encontrada</h1>
      <p>
        La dirección no existe en el panel. <Link to="/">Volver al Dashboard</Link>
      </p>
    </>
  );
}
