import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { ErrorApi } from "../../api/cliente";
import type { Acopiador, AcopiadorCambios } from "../../api/tipos";
import { editarAcopiador, obtenerAcopiador } from "../../api/usuarios";
import { fecha } from "../../comun/formato";
import { Insignia } from "../../comun/Insignia";
import { MuestraColor } from "../../comun/MuestraColor";
import { useCarga } from "../../comun/useCarga";
import { useTitulo } from "../../comun/useTitulo";
import { AccesoMovil } from "../../usuarios/AccesoMovil";
import { CambiarActivo } from "../../usuarios/CambiarActivo";
import { useAvisoCreado } from "../../usuarios/useAvisoCreado";
import { datosDe, FormularioAcopiador, valoresDe } from "./FormularioAcopiador";

/** Solo los campos que cambiaron (PATCH). */
export function cambiosDe(antes: Acopiador, despues: ReturnType<typeof datosDe>): AcopiadorCambios {
  const cambios: AcopiadorCambios = {};
  if (despues.nombre_completo !== antes.nombre_completo) cambios.nombre_completo = despues.nombre_completo;
  if (despues.dni !== antes.dni) cambios.dni = despues.dni;
  if (despues.celular !== antes.celular) cambios.celular = despues.celular;
  if (despues.color_hex !== antes.color_hex.toUpperCase()) cambios.color_hex = despues.color_hex;
  if (despues.vehiculo !== antes.vehiculo) cambios.vehiculo = despues.vehiculo;
  if (despues.sueldo_base_mensual !== antes.sueldo_base_mensual) cambios.sueldo_base_mensual = despues.sueldo_base_mensual;
  if (despues.comision_por_litro !== antes.comision_por_litro) cambios.comision_por_litro = despues.comision_por_litro;
  return cambios;
}

export default function AcopiadorDetalle() {
  const { id } = useParams();
  const numero = Number(id);
  const valido = Number.isInteger(numero) && numero > 0;
  const { carga, recargar, ponerDatos } = useCarga(
    () => (valido ? obtenerAcopiador(numero) : Promise.reject(new ErrorApi(404, "no_encontrado", "El acopiador no existe"))),
    [numero],
  );
  const [recienCreado, olvidarCreado] = useAvisoCreado();
  const [cambiarActivo, setCambiarActivo] = useState(false);
  useTitulo(carga.estado === "listo" ? carga.datos.nombre_completo : "Acopiador");

  const miga = <p className="miga"><Link to="/acopiadores">Acopiadores</Link> › Detalle</p>;
  if (carga.estado === "cargando") return <>{miga}<p>Cargando acopiador…</p></>;
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

  const a = carga.datos;
  return (
    <>
      {miga}
      <div className="encabezado">
        <h1><MuestraColor color={a.color_hex} /> {a.nombre_completo}</h1>
        {!a.activo && <Insignia tono="neutro">Inactivo</Insignia>}
      </div>

      {recienCreado && a.pin_pendiente && (
        <p className="aviso aviso-ok" role="status">
          Acopiador creado. Está pendiente de activar: genere su código de activación más abajo.
        </p>
      )}

      <section className="seccion" aria-labelledby="datos-titulo">
        <h2 id="datos-titulo">Datos</h2>
        <FormularioAcopiador
          key={a.id}
          inicial={valoresDe(a)}
          textoGuardar="Guardar cambios"
          onGuardar={async (v) => {
            olvidarCreado();
            const cambios = cambiosDe(a, datosDe(v));
            if (Object.keys(cambios).length === 0) return "No hay cambios que guardar.";
            ponerDatos(await editarAcopiador(a.id, cambios));
            return "Cambios guardados.";
          }}
          extra={
            <button type="button" className={a.activo ? "boton boton-peligro-suave" : "boton boton-secundario"}
                    onClick={() => setCambiarActivo(true)}>
              {a.activo ? "Desactivar acopiador" : "Reactivar acopiador"}
            </button>
          }
        />
      </section>

      <section className="seccion" aria-labelledby="rutas-titulo">
        <h2 id="rutas-titulo">Rutas vigentes</h2>
        {a.rutas.length === 0 ? (
          <p><Insignia tono="atencion">Sin rutas</Insignia> Sin rutas asignadas, su celular no verá productores.</p>
        ) : (
          <ul>
            {a.rutas.map((r) => <li key={r.ruta_id}>{r.nombre} <span className="texto-suave">desde {fecha(r.vigente_desde)}</span></li>)}
          </ul>
        )}
      </section>

      <AccesoMovil usuario={a} onCambio={recargar} onAccion={olvidarCreado} />

      {cambiarActivo && (
        <CambiarActivo
          rol="acopiador"
          activo={a.activo}
          onCerrar={() => setCambiarActivo(false)}
          onConfirmar={async () => {
            olvidarCreado();
            ponerDatos(await editarAcopiador(a.id, { activo: !a.activo }));
            setCambiarActivo(false);
          }}
        />
      )}
    </>
  );
}
