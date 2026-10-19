import { useId, useState } from "react";
import { Link } from "react-router-dom";

import { listarAnalistas } from "../../api/usuarios";
import { Insignia } from "../../comun/Insignia";
import { useCarga } from "../../comun/useCarga";
import { useTitulo } from "../../comun/useTitulo";
import { estadoAcceso } from "../../usuarios/estadoAcceso";

/** A13 (parcial) · Lista de analistas con su estado de acceso al celular. */
export default function Analistas() {
  useTitulo("Analistas");
  const id = useId();
  const { carga, recargar } = useCarga(listarAnalistas, []);
  const [busqueda, setBusqueda] = useState("");
  const [conInactivos, setConInactivos] = useState(false);

  const termino = busqueda.trim().toLowerCase();
  const filas = carga.estado === "listo"
    ? carga.datos.filter((a) => (conInactivos || a.activo)
        && (termino === "" || a.nombre_completo.toLowerCase().includes(termino) || a.dni.includes(termino)))
    : [];

  return (
    <>
      <div className="encabezado">
        <h1>Analistas</h1>
        <Link to="/analistas/nuevo" className="boton boton-primario">Nuevo analista</Link>
      </div>

      <div className="filtros">
        <div className="campo campo-en-linea">
          <label htmlFor={`${id}-buscar`}>Buscar</label>
          <input id={`${id}-buscar`} type="search" placeholder="Nombre o DNI" value={busqueda}
                 onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        <label className="casilla">
          <input type="checkbox" checked={conInactivos} onChange={(e) => setConInactivos(e.target.checked)} />
          Mostrar inactivos
        </label>
      </div>

      {carga.estado === "cargando" && <p>Cargando analistas…</p>}
      {carga.estado === "error" && (
        <p className="aviso aviso-error" role="alert">
          {carga.mensaje}{" "}
          <button type="button" className="boton-enlace" onClick={recargar}>Reintentar</button>
        </p>
      )}
      {carga.estado === "listo" && (filas.length === 0 ? (
        <p className="texto-suave">
          {carga.datos.length === 0 ? "Todavía no hay analistas." : "Ningún analista coincide con la búsqueda."}
        </p>
      ) : (
        <table className="tabla">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>DNI</th>
              <th>Celular</th>
              <th>Acceso al celular</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((a) => {
              const estado = estadoAcceso(a);
              return (
                <tr key={a.id}>
                  <td><Link to={`/analistas/${a.id}`}>{a.nombre_completo}</Link></td>
                  <td>{a.dni}</td>
                  <td>{a.celular}</td>
                  <td><Insignia tono={estado.tono}>{estado.texto}</Insignia></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ))}
    </>
  );
}
