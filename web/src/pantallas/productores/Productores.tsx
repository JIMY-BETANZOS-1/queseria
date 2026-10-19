import { useId, useState } from "react";
import { Link } from "react-router-dom";

import { listarProductores } from "../../api/productores";
import { listarRutas } from "../../api/rutas";
import type { ProductorResumen, TipoProductor } from "../../api/tipos";
import { fecha, fechaHoraLima, litros } from "../../comun/formato";
import { Insignia } from "../../comun/Insignia";
import { MuestraColor } from "../../comun/MuestraColor";
import { useCarga } from "../../comun/useCarga";
import { useTitulo } from "../../comun/useTitulo";
import { TIPOS } from "./FormularioProductor";

/** Insignias de estado: pendiente de aprobación, bloqueo o sanción de hoy, inactivo. */
function Estados({ p }: { p: ProductorResumen }) {
  return (
    <>
      {p.pendiente_aprobacion && <Insignia tono="atencion">Pendiente de aprobación</Insignia>}{" "}
      {p.bloqueado ? (
        <Insignia tono="error">Bloqueado{p.sancion_hasta ? ` hasta ${fecha(p.sancion_hasta)}` : ""}</Insignia>
      ) : p.sancionado && (
        <Insignia tono="atencion">Sancionado{p.sancion_hasta ? ` hasta ${fecha(p.sancion_hasta)}` : ""}</Insignia>
      )}{" "}
      {!p.activo && <Insignia tono="neutro">Inactivo</Insignia>}
    </>
  );
}

/** A4 (parcial) · Lista de productores con altas de campo pendientes primero (orden del servidor). */
export default function Productores() {
  useTitulo("Productores");
  const id = useId();
  const { carga, recargar } = useCarga(listarProductores, []);
  // Solo para mostrar el nombre de la ruta y filtrar; si falla, la lista funciona igual
  const rutas = useCarga(listarRutas, []);
  const [busqueda, setBusqueda] = useState("");
  const [tipo, setTipo] = useState<TipoProductor | "">("");
  const [rutaId, setRutaId] = useState("");
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [conInactivos, setConInactivos] = useState(false);

  const nombreRuta = new Map(rutas.carga.estado === "listo" ? rutas.carga.datos.map((r) => [r.id, r.nombre]) : []);
  const termino = busqueda.trim().toLowerCase();
  const todos = carga.estado === "listo" ? carga.datos : [];
  const pendientes = todos.filter((p) => p.pendiente_aprobacion && p.activo).length;
  const filas = todos.filter((p) => (conInactivos || p.activo)
    && (!soloPendientes || p.pendiente_aprobacion)
    && (tipo === "" || p.tipo === tipo)
    && (rutaId === "" || String(p.ruta_id) === rutaId)
    && (termino === "" || p.nombre.toLowerCase().includes(termino) || p.codigo.toLowerCase().includes(termino)));

  return (
    <>
      <div className="encabezado">
        <h1>Productores</h1>
        <Link to="/productores/nuevo" className="boton boton-primario">Nuevo productor</Link>
      </div>

      {pendientes > 0 && (
        <p className="aviso aviso-atencion">
          {pendientes === 1 ? "1 alta de campo pendiente" : `${pendientes} altas de campo pendientes`} de aprobación:
          su leche se recibe, pero el pago queda retenido.{" "}
          {!soloPendientes && (
            <button type="button" className="boton-enlace" onClick={() => setSoloPendientes(true)}>Ver solo pendientes</button>
          )}
        </p>
      )}

      <div className="filtros">
        <div className="campo campo-en-linea">
          <label htmlFor={`${id}-buscar`}>Buscar</label>
          <input id={`${id}-buscar`} type="search" placeholder="Nombre o código" value={busqueda}
                 onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        <div className="campo campo-en-linea">
          <label htmlFor={`${id}-tipo`}>Tipo</label>
          <select id={`${id}-tipo`} value={tipo} onChange={(e) => setTipo(e.target.value as TipoProductor | "")}>
            <option value="">Todos</option>
            {TIPOS.map((t) => <option key={t.valor} value={t.valor}>{t.texto}</option>)}
          </select>
        </div>
        <div className="campo campo-en-linea">
          <label htmlFor={`${id}-ruta`}>Ruta</label>
          <select id={`${id}-ruta`} value={rutaId} onChange={(e) => setRutaId(e.target.value)}>
            <option value="">Todas</option>
            {rutas.carga.estado === "listo" && rutas.carga.datos.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </select>
        </div>
        <label className="casilla">
          <input type="checkbox" checked={soloPendientes} onChange={(e) => setSoloPendientes(e.target.checked)} />
          Solo pendientes
        </label>
        <label className="casilla">
          <input type="checkbox" checked={conInactivos} onChange={(e) => setConInactivos(e.target.checked)} />
          Mostrar inactivos
        </label>
      </div>

      {carga.estado === "cargando" && <p>Cargando productores…</p>}
      {carga.estado === "error" && (
        <p className="aviso aviso-error" role="alert">
          {carga.mensaje}{" "}
          <button type="button" className="boton-enlace" onClick={recargar}>Reintentar</button>
        </p>
      )}
      {carga.estado === "listo" && (filas.length === 0 ? (
        <p className="texto-suave">
          {todos.length === 0 ? "Todavía no hay productores." : "Ningún productor coincide con los filtros."}
        </p>
      ) : (
        <table className="tabla">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre</th>
              <th>Ruta</th>
              <th>Acopiador</th>
              <th className="numero">Entregado</th>
              <th className="numero">Descartado</th>
              <th>Última entrega</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((p) => (
              <tr key={p.productor_id}>
                <td>{p.codigo}</td>
                <td><Link to={`/productores/${p.productor_id}`}>{p.nombre}</Link></td>
                <td>
                  {p.tipo === "externo" ? "Externo" : (p.ruta_id !== null && nombreRuta.get(p.ruta_id)) || `Ruta ${p.ruta_id}`}
                </td>
                <td>{p.acopiador && <>{p.color_hex && <MuestraColor color={p.color_hex} />} {p.acopiador}</>}</td>
                <td className="numero">{litros(p.litros_total)}</td>
                <td className="numero">{litros(p.litros_descartados)}</td>
                <td>{p.ultima_recoleccion ? fechaHoraLima(p.ultima_recoleccion) : "Nunca"}</td>
                <td><Estados p={p} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </>
  );
}
