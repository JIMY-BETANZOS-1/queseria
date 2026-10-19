import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { ErrorApi } from "../../api/cliente";
import { aprobarProductor, editarProductor, obtenerProductor, recoleccionesDeProductor } from "../../api/productores";
import { listarRutas } from "../../api/rutas";
import type { Productor } from "../../api/tipos";
import { listarAcopiadores } from "../../api/usuarios";
import { Confirmar } from "../../comun/Confirmar";
import { fechaHoraLima, litros } from "../../comun/formato";
import { Insignia } from "../../comun/Insignia";
import { useAvisoCreado } from "../../comun/useAvisoCreado";
import { useCarga } from "../../comun/useCarga";
import { useTitulo } from "../../comun/useTitulo";
import { EstadoPago } from "./EstadoPago";
import { cambiosDe, datosDe, FormularioProductor, valoresDe } from "./FormularioProductor";

/** Cuántas recolecciones se muestran (las más recientes). */
export const ULTIMAS = 50;

/** Nombre de quien dio de alta en el campo (solo un acopiador puede: fn_productor_alta). */
function CreadoPor({ usuarioId }: { usuarioId: number | null }) {
  const acopiadores = useCarga(listarAcopiadores, []);
  const nombre = acopiadores.carga.estado === "listo"
    ? acopiadores.carga.datos.find((a) => a.id === usuarioId)?.nombre_completo
    : undefined;
  return <>{nombre ?? "un acopiador"}</>;
}

/** A4 (parcial) · Detalle de un productor: aprobación del alta de campo, datos y últimas recolecciones. */
export default function ProductorDetalle() {
  const { id } = useParams();
  const numero = Number(id);
  const valido = Number.isInteger(numero) && numero > 0;
  const { carga, recargar, ponerDatos } = useCarga(
    () => (valido ? obtenerProductor(numero) : Promise.reject(new ErrorApi(404, "no_encontrado", "El productor no existe"))),
    [numero],
  );
  const recolecciones = useCarga(() => (valido ? recoleccionesDeProductor(numero, ULTIMAS) : Promise.resolve([])), [numero]);
  const rutas = useCarga(listarRutas, []);
  const [recienCreado, olvidarCreado] = useAvisoCreado();
  const [ventana, setVentana] = useState<"aprobar" | "activo" | null>(null);
  useTitulo(carga.estado === "listo" ? carga.datos.nombre : "Productor");

  const miga = <p className="miga"><Link to="/productores">Productores</Link> › Detalle</p>;
  if (carga.estado === "cargando") return <>{miga}<p>Cargando productor…</p></>;
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

  const p: Productor = carga.datos;
  const pendiente = !p.aprobado;

  function abrir(cual: "aprobar" | "activo") {
    olvidarCreado();
    setVentana(cual);
  }

  return (
    <>
      {miga}
      <div className="encabezado">
        <h1>{p.nombre} <span className="texto-suave">{p.codigo}</span></h1>
        {pendiente && <Insignia tono="atencion">Pendiente de aprobación</Insignia>}
        {!p.activo && <Insignia tono="neutro">Inactivo</Insignia>}
      </div>

      {recienCreado && (
        <p className="aviso aviso-ok" role="status">Productor creado con el código {p.codigo}.</p>
      )}

      {pendiente && (
        <div className="aviso aviso-atencion">
          <p>
            Alta en el campo por <CreadoPor usuarioId={p.creado_por} />: su leche se recibe, pero el pago queda
            retenido hasta que la apruebe. Revise sus datos y sus entregas antes de aprobar.
          </p>
          <div className="fila-acciones">
            <button type="button" className="boton boton-primario" onClick={() => abrir("aprobar")}>
              Aprobar productor
            </button>
          </div>
        </div>
      )}

      <section className="seccion" aria-labelledby="datos-titulo">
        <h2 id="datos-titulo">Datos</h2>
        {rutas.carga.estado === "cargando" && <p>Cargando…</p>}
        {rutas.carga.estado === "error" && (
          <p className="aviso aviso-error" role="alert">
            {rutas.carga.mensaje}{" "}
            <button type="button" className="boton-enlace" onClick={rutas.recargar}>Reintentar</button>
          </p>
        )}
        {rutas.carga.estado === "listo" && (
          <FormularioProductor
            key={p.id}
            inicial={valoresDe(p)}
            rutas={rutas.carga.datos.filter((r) => r.activa || r.id === p.ruta_id)}
            tipoEditable={false}
            textoGuardar="Guardar cambios"
            onGuardar={async (v) => {
              olvidarCreado();
              const cambios = cambiosDe(p, datosDe(v));
              if (Object.keys(cambios).length === 0) return "No hay cambios que guardar.";
              ponerDatos(await editarProductor(p.id, cambios));
              return "Cambios guardados.";
            }}
            extra={
              <button type="button" className={p.activo ? "boton boton-peligro-suave" : "boton boton-secundario"}
                      onClick={() => abrir("activo")}>
                {p.activo ? "Desactivar productor" : "Reactivar productor"}
              </button>
            }
          />
        )}
      </section>

      <section className="seccion" aria-labelledby="recolecciones-titulo">
        <h2 id="recolecciones-titulo">Últimas recolecciones</h2>
        {recolecciones.carga.estado === "cargando" && <p>Cargando recolecciones…</p>}
        {recolecciones.carga.estado === "error" && (
          <p className="aviso aviso-error" role="alert">
            {recolecciones.carga.mensaje}{" "}
            <button type="button" className="boton-enlace" onClick={recolecciones.recargar}>Reintentar</button>
          </p>
        )}
        {recolecciones.carga.estado === "listo" && (recolecciones.carga.datos.length === 0 ? (
          <p className="texto-suave">Todavía no entregó leche.</p>
        ) : (
          <>
            <table className="tabla">
              <thead>
                <tr>
                  <th>Fecha y hora</th>
                  <th className="numero">Litros</th>
                  <th>Calidad</th>
                  <th>Revisada</th>
                  <th>Registró</th>
                  <th className="numero">Alertas sin revisar</th>
                  <th>Pago</th>
                </tr>
              </thead>
              <tbody>
                {recolecciones.carga.datos.map((r) => (
                  <tr key={r.recoleccion_id}>
                    <td>{fechaHoraLima(r.registrada_en)}</td>
                    <td className="numero">{litros(r.litros)}</td>
                    <td>{r.estado_calidad === "alterado" ? <Insignia tono="error">Alterada</Insignia> : "Normal"}</td>
                    <td>{r.revisada ? "Sí" : "No"}</td>
                    <td>{r.registrado_por_nombre}</td>
                    <td className="numero">{r.alertas_pendientes > 0 ? r.alertas_pendientes : ""}</td>
                    <td><EstadoPago recoleccion={r} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {recolecciones.carga.datos.length >= ULTIMAS && (
              <p className="texto-suave">Se muestran las últimas {ULTIMAS}.</p>
            )}
          </>
        ))}
      </section>

      {ventana === "aprobar" && (
        <Confirmar
          titulo="Aprobar productor"
          textoConfirmar="Aprobar"
          onCerrar={() => setVentana(null)}
          onConfirmar={async () => {
            ponerDatos(await aprobarProductor(p.id));
            setVentana(null);
            recolecciones.recargar();
          }}
        >
          {/* v_recoleccion_pago: retenida = NOT aprobado OR alerta que retiene sin revisar; pagable = revisada y no retenida */}
          <ul className="lista-avisos">
            <li>Su leche deja de quedar retenida por "productor no aprobado", también la ya registrada.</li>
            <li>
              Sigue retenida la que tenga una alerta de productor bloqueado o firma inválida sin revisar, y solo se paga
              la que ya revisó el analista.
            </li>
            <li>No se puede deshacer desde el panel.</li>
          </ul>
        </Confirmar>
      )}

      {ventana === "activo" && (
        <Confirmar
          titulo={p.activo ? "Desactivar productor" : "Reactivar productor"}
          textoConfirmar={p.activo ? "Desactivar" : "Reactivar"}
          peligro={p.activo}
          onCerrar={() => setVentana(null)}
          onConfirmar={async () => {
            ponerDatos(await editarProductor(p.id, { activo: !p.activo }));
            setVentana(null);
          }}
        >
          {/* Los pull filtran p.activo; el push no lo revisa */}
          {p.activo ? (
            <ul className="lista-avisos">
              <li>Deja de aparecer en los celulares en su próxima sincronización. Lo que tengan sin enviar se sube igual.</li>
              {pendiente && <li>Su leche ya registrada sigue retenida por no aprobado.</li>}
            </ul>
          ) : (
            <ul className="lista-avisos">
              <li>Vuelve a aparecer en los celulares en su próxima sincronización.</li>
            </ul>
          )}
        </Confirmar>
      )}
    </>
  );
}
