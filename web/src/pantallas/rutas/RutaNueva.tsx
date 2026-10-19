import { Link, useNavigate } from "react-router-dom";

import { crearRuta } from "../../api/rutas";
import { useTitulo } from "../../comun/useTitulo";
import { datosDe, FormularioRuta, VACIO } from "./FormularioRuta";

export default function RutaNueva() {
  useTitulo("Nueva ruta");
  const navegar = useNavigate();

  return (
    <>
      <p className="miga"><Link to="/rutas">Rutas</Link> › Nueva</p>
      <h1>Nueva ruta</h1>
      <FormularioRuta
        inicial={VACIO}
        textoGuardar="Crear ruta"
        onGuardar={async (v) => {
          const creada = await crearRuta(datosDe(v));
          navegar(`/rutas/${creada.id}`, { state: { creado: true } });
          return null;
        }}
      />
    </>
  );
}
