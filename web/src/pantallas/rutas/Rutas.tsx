import { useId, useState } from "react";
import { Link } from "react-router-dom";

import type { Ruta } from "../../api/tipos";
import { listarRutas } from "../../api/rutas";
import { Insignia } from "../../comun/Insignia";
import { MuestraColor } from "../../comun/MuestraColor";
import { useCarga } from "../../comun/useCarga";
import { useTitulo } from "../../comun/useTitulo";

/** Acopiador vigente de una ruta (con su color y enlace), o la marca "Sin acopiador". */
export function AcopiadorDeRuta({ ruta }: { ruta: Ruta }) {
  if (ruta.acopiador_id == null) return <Insignia tono="atencion">Sin acopiador</Insignia>;
  return (
    <>
      {ruta.color_hex && <MuestraColor color={ruta.color_hex} />}{" "}
      <Link to={`/acopiadores/${ruta.acopiador_id}`}>{ruta.acopiador}</Link>
    </>
  );
}

/** A5b · Lista de rutas con su acopiador vigente. */
export default function Rutas() {
  useTitulo("Rutas");
  const id = useId();
  const { carga, recargar } = useCarga(listarRutas, []);
  const [busqueda, setBusqueda] = useState("");
  const [conInactivas, setConInactivas] = useState(false);

  const termino = busqueda.trim().toLowerCase();
  const filas = carga.estado === "listo"
    ? carga.datos.filter((r) => (conInactivas || r.activa) && (termino === "" || r.nombre.toLowerCase().includes(termino)))
    : [];

  return (
    <>
      <div className="encabezado">
        <h1>Rutas</h1>
        <Link to="/rutas/nueva" className="boton boton-primario">Nueva ruta</Link>
      </div>

      <div className="filtros">
        <div className="campo campo-en-linea">
          <label htmlFor={`${id}-buscar`}>Buscar</label>
          <input id={`${id}-buscar`} type="search" placeholder="Nombre" value={busqueda}
                 onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        <label className="casilla">
          <input type="checkbox" checked={conInactivas} onChange={(e) => setConInactivas(e.target.checked)} />
          Mostrar inactivas
        </label>
      </div>

      {carga.estado === "cargando" && <p>Cargando rutas…</p>}
      {carga.estado === "error" && (
        <p className="aviso aviso-error" role="alert">
          {carga.mensaje}{" "}
          <button type="button" className="boton-enlace" onClick={recargar}>Reintentar</button>
        </p>
      )}
      {carga.estado === "listo" && (filas.length === 0 ? (
        <p className="texto-suave">
          {carga.datos.length === 0 ? "Todavía no hay rutas." : "Ninguna ruta coincide con la búsqueda."}
        </p>
      ) : (
        <table className="tabla">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Descripción</th>
              <th>Acopiador vigente</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((r) => (
              <tr key={r.id}>
                <td><Link to={`/rutas/${r.id}`}>{r.nombre}</Link></td>
                <td>{r.descripcion ?? ""}</td>
                <td><AcopiadorDeRuta ruta={r} /></td>
                <td>{r.activa ? <Insignia tono="ok">Activa</Insignia> : <Insignia tono="neutro">Inactiva</Insignia>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </>
  );
}
