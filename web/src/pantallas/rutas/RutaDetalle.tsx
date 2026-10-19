import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { ErrorApi } from "../../api/cliente";
import { editarRuta, historialAsignaciones, obtenerRuta, quitarAcopiador } from "../../api/rutas";
import type { Ruta, RutaCambios } from "../../api/tipos";
import { Confirmar } from "../../comun/Confirmar";
import { fecha } from "../../comun/formato";
import { Insignia } from "../../comun/Insignia";
import { useAvisoCreado } from "../../comun/useAvisoCreado";
import { useCarga } from "../../comun/useCarga";
import { useTitulo } from "../../comun/useTitulo";
import { AsignarAcopiador } from "./AsignarAcopiador";
import { datosDe, FormularioRuta, valoresDe } from "./FormularioRuta";
import { AcopiadorDeRuta } from "./Rutas";

/** Solo los campos que cambiaron (PATCH). */
export function cambiosDe(antes: Ruta, despues: ReturnType<typeof datosDe>): RutaCambios {
  const cambios: RutaCambios = {};
  if (despues.nombre !== antes.nombre) cambios.nombre = despues.nombre;
  if (despues.descripcion !== antes.descripcion) cambios.descripcion = despues.descripcion;
  return cambios;
}

/** A5b · Detalle de una ruta: datos, acopiador vigente e historial de asignaciones. */
export default function RutaDetalle() {
  const { id } = useParams();
  const numero = Number(id);
  const valido = Number.isInteger(numero) && numero > 0;
  const { carga, recargar, ponerDatos } = useCarga(
    () => (valido ? obtenerRuta(numero) : Promise.reject(new ErrorApi(404, "no_encontrado", "La ruta no existe"))),
    [numero],
  );
  const historial = useCarga(() => (valido ? historialAsignaciones(numero) : Promise.resolve([])), [numero]);
  const [recienCreada, olvidarCreada] = useAvisoCreado();
  const [ventana, setVentana] = useState<"activa" | "asignar" | "quitar" | null>(null);
  useTitulo(carga.estado === "listo" ? carga.datos.nombre : "Ruta");

  const miga = <p className="miga"><Link to="/rutas">Rutas</Link> › Detalle</p>;
  if (carga.estado === "cargando") return <>{miga}<p>Cargando ruta…</p></>;
  if (carga.estado === "error") {
    return (
      <>
        {miga}
        <p className="aviso aviso-error" role="alert">
          {carga.mensaje}{" "}
          <button type="button" className="boton-enlace" onClick={recargar}>Reintentar</button>
        </p>
      </>
    );
  }

  const r = carga.datos;
  const acopiador = r.acopiador_id != null ? r.acopiador : null;
  const vigente = historial.carga.estado === "listo" ? historial.carga.datos.find((a) => a.vigente_hasta === null) : undefined;

  function abrir(cual: "activa" | "asignar" | "quitar") {
    olvidarCreada();
    setVentana(cual);
  }

  function despuesDeAsignar() {
    setVentana(null);
    recargar();
    historial.recargar();
  }

  return (
    <>
      {miga}
      <div className="encabezado">
        <h1>{r.nombre}</h1>
        {!r.activa && <Insignia tono="neutro">Inactiva</Insignia>}
      </div>

      {recienCreada && acopiador === null && (
        <p className="aviso aviso-ok" role="status">
          Ruta creada. Todavía no tiene acopiador: asígnelo más abajo.
        </p>
      )}

      <section className="seccion" aria-labelledby="datos-titulo">
        <h2 id="datos-titulo">Datos</h2>
        <FormularioRuta
          key={r.id}
          inicial={valoresDe(r)}
          textoGuardar="Guardar cambios"
          onGuardar={async (v) => {
            olvidarCreada();
            const cambios = cambiosDe(r, datosDe(v));
            if (Object.keys(cambios).length === 0) return "No hay cambios que guardar.";
            ponerDatos(await editarRuta(r.id, cambios));
            return "Cambios guardados.";
          }}
          extra={
            <button type="button" className={r.activa ? "boton boton-peligro-suave" : "boton boton-secundario"}
                    onClick={() => abrir("activa")}>
              {r.activa ? "Desactivar ruta" : "Reactivar ruta"}
            </button>
          }
        />
      </section>

      <section className="seccion" aria-labelledby="acopiador-titulo">
        <h2 id="acopiador-titulo">Acopiador vigente</h2>
        {acopiador === null ? (
          <p>
            <AcopiadorDeRuta ruta={r} /> Ningún celular ve los productores de esta ruta.
          </p>
        ) : (
          <p>
            <AcopiadorDeRuta ruta={r} />
            {vigente && <span className="texto-suave"> desde {fecha(vigente.vigente_desde)}</span>}
          </p>
        )}
        <div className="fila-acciones">
          <button type="button" className="boton boton-primario" onClick={() => abrir("asignar")}
                  disabled={historial.carga.estado !== "listo"}>
            {acopiador === null ? "Asignar acopiador" : "Cambiar acopiador"}
          </button>
          {acopiador !== null && (
            <button type="button" className="boton boton-secundario" onClick={() => abrir("quitar")}>
              Quitar acopiador
            </button>
          )}
        </div>
      </section>

      <section className="seccion" aria-labelledby="historial-titulo">
        <h2 id="historial-titulo">Historial de asignaciones</h2>
        {historial.carga.estado === "cargando" && <p>Cargando historial…</p>}
        {historial.carga.estado === "error" && (
          <p className="aviso aviso-error" role="alert">
            {historial.carga.mensaje}{" "}
            <button type="button" className="boton-enlace" onClick={historial.recargar}>Reintentar</button>
          </p>
        )}
        {historial.carga.estado === "listo" && (historial.carga.datos.length === 0 ? (
          <p className="texto-suave">Nunca tuvo acopiador.</p>
        ) : (
          <table className="tabla">
            <thead>
              <tr>
                <th>Acopiador</th>
                <th>Desde</th>
                <th>Hasta</th>
              </tr>
            </thead>
            <tbody>
              {historial.carga.datos.map((a) => (
                <tr key={a.id}>
                  <td><Link to={`/acopiadores/${a.acopiador_id}`}>{a.acopiador ?? `Acopiador ${a.acopiador_id}`}</Link></td>
                  <td>{fecha(a.vigente_desde)}</td>
                  <td>{a.vigente_hasta === null ? <Insignia tono="ok">Vigente</Insignia> : fecha(a.vigente_hasta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </section>

      {ventana === "asignar" && historial.carga.estado === "listo" && (
        <AsignarAcopiador ruta={r} historial={historial.carga.datos} onHecho={despuesDeAsignar}
                          onCerrar={() => setVentana(null)} />
      )}

      {ventana === "quitar" && acopiador !== null && (
        <Confirmar
          titulo="Quitar acopiador"
          textoConfirmar="Quitar acopiador"
          peligro
          onCerrar={() => setVentana(null)}
          onConfirmar={async () => {
            await quitarAcopiador(r.id);
            despuesDeAsignar();
          }}
        >
          <ul className="lista-avisos">
            <li>
              {acopiador} deja de ver esta ruta y sus productores en su celular en su próxima sincronización. Lo
              que tenga sin enviar se sube igual.
            </li>
            <li>La ruta queda sin acopiador hasta que asigne otro. En el historial se cierra con fecha de hoy.</li>
          </ul>
        </Confirmar>
      )}

      {ventana === "activa" && (
        <Confirmar
          titulo={r.activa ? "Desactivar ruta" : "Reactivar ruta"}
          textoConfirmar={r.activa ? "Desactivar" : "Reactivar"}
          peligro={r.activa}
          onCerrar={() => setVentana(null)}
          onConfirmar={async () => {
            ponerDatos(await editarRuta(r.id, { activa: !r.activa }));
            setVentana(null);
          }}
        >
          {/* El pull filtra r.activa; desactivar no cierra la asignación (PATCH solo cambia activa) */}
          {r.activa ? (
            <ul className="lista-avisos">
              {acopiador === null ? (
                <li>No tiene acopiador: ningún celular la ve ahora.</li>
              ) : (
                <li>
                  {acopiador} deja de verla en su celular, junto con sus productores, en su próxima sincronización.
                  Lo que tenga sin enviar se sube igual.
                </li>
              )}
              <li>
                Los productores siguen en esta ruta y la asignación no cambia
                {acopiador === null ? "." : ": al reactivarla, vuelven a su celular."}
              </li>
            </ul>
          ) : (
            <ul className="lista-avisos">
              {acopiador === null ? (
                <li>No tiene acopiador: asígnelo para que un celular la vea.</li>
              ) : (
                <li>Vuelve a aparecer en el celular de {acopiador} en su próxima sincronización.</li>
              )}
            </ul>
          )}
        </Confirmar>
      )}
    </>
  );
}
