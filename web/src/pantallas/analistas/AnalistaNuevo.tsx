import { Link, useNavigate } from "react-router-dom";

import { crearAnalista } from "../../api/usuarios";
import { useTitulo } from "../../comun/useTitulo";
import { datosDe, FormularioAnalista, VACIO } from "./FormularioAnalista";

export default function AnalistaNuevo() {
  useTitulo("Nuevo analista");
  const navegar = useNavigate();

  return (
    <>
      <p className="miga"><Link to="/analistas">Analistas</Link> › Nuevo</p>
      <h1>Nuevo analista</h1>
      <p className="texto-suave">
        No se pide PIN: el analista crea el suyo al activar su celular con el código que usted genere después.
      </p>
      <FormularioAnalista
        inicial={VACIO}
        textoGuardar="Crear analista"
        onGuardar={async (v) => {
          const creado = await crearAnalista(datosDe(v));
          navegar(`/analistas/${creado.id}`, { state: { creado: true } });
          return null;
        }}
      />
    </>
  );
}
