import { Link, useNavigate } from "react-router-dom";

import { crearProductor } from "../../api/productores";
import { listarRutas } from "../../api/rutas";
import { useCarga } from "../../comun/useCarga";
import { useTitulo } from "../../comun/useTitulo";
import { datosDe, FormularioProductor, VACIO } from "./FormularioProductor";

export default function ProductorNuevo() {
  useTitulo("Nuevo productor");
  const navegar = useNavigate();
  const rutas = useCarga(listarRutas, []);

  const miga = <p className="miga"><Link to="/productores">Productores</Link> › Nuevo</p>;
  if (rutas.carga.estado === "cargando") return <>{miga}<p>Cargando…</p></>;
  if (rutas.carga.estado === "error") {
    return (
      <>
        {miga}
        <p className="aviso aviso-error" role="alert">
          {rutas.carga.mensaje}{" "}
          <button type="button" className="boton-enlace" onClick={rutas.recargar}>Reintentar</button>
        </p>
      </>
    );
  }

  return (
    <>
      {miga}
      <h1>Nuevo productor</h1>
      <p className="texto-suave">
        El código se asigna solo. Un productor creado aquí ya queda aprobado: su leche no se retiene por aprobación.
      </p>
      <FormularioProductor
        inicial={VACIO}
        rutas={rutas.carga.datos.filter((r) => r.activa)}
        tipoEditable
        textoGuardar="Crear productor"
        onGuardar={async (v) => {
          const creado = await crearProductor(datosDe(v));
          navegar(`/productores/${creado.id}`, { state: { creado: true } });
          return null;
        }}
      />
    </>
  );
}
