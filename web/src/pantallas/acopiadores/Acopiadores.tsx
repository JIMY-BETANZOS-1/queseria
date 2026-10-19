import { useId, useState } from "react";
import { Link } from "react-router-dom";

import { listarAcopiadores } from "../../api/usuarios";
import { Insignia } from "../../comun/Insignia";
import { MuestraColor } from "../../comun/MuestraColor";
import { useCarga } from "../../comun/useCarga";
import { useTitulo } from "../../comun/useTitulo";
import { estadoAcceso } from "../../usuarios/estadoAcceso";
import { textoVehiculo } from "./FormularioAcopiador";

/** A5 (parcial) · Lista de acopiadores con su estado de acceso al celular. */
export default function Acopiadores() {
  useTitulo("Acopiadores");
  const id = useId();
  const { carga, recargar } = useCarga(listarAcopiadores, []);
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
        <h1>Acopiadores</h1>
        <Link to="/acopiadores/nuevo" className="boton boton-primario">Nuevo acopiador</Link>
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

      {carga.estado === "cargando" && <p>Cargando acopiadores…</p>}
      {carga.estado === "error" && (
        <p className="aviso aviso-error" role="alert">
          {carga.mensaje}{" "}
          <button type="button" className="boton-enlace" onClick={recargar}>Reintentar</button>
        </p>
      )}
      {carga.estado === "listo" && (filas.length === 0 ? (
        <p className="texto-suave">
          {carga.datos.length === 0 ? "Todavía no hay acopiadores." : "Ningún acopiador coincide con la búsqueda."}
        </p>
      ) : (
        <table className="tabla">
          <thead>
            <tr>
              <th>Color</th>
              <th>Nombre</th>
              <th>DNI</th>
              <th>Celular</th>
              <th>Rutas vigentes</th>
              <th>Vehículo</th>
              <th>Acceso al celular</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((a) => {
              const estado = estadoAcceso(a);
              return (
                <tr key={a.id}>
                  <td><MuestraColor color={a.color_hex} /></td>
                  <td><Link to={`/acopiadores/${a.id}`}>{a.nombre_completo}</Link></td>
                  <td>{a.dni}</td>
                  <td>{a.celular}</td>
                  <td>
                    {a.rutas.length === 0
                      ? <Insignia tono="atencion">Sin rutas</Insignia>
                      : a.rutas.map((r) => r.nombre).join(", ")}
                  </td>
                  <td>{textoVehiculo(a.vehiculo)}</td>
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
