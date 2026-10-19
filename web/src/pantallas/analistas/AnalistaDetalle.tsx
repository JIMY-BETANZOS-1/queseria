import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { ErrorApi } from "../../api/cliente";
import type { Analista, AnalistaCambios } from "../../api/tipos";
import { editarAnalista, obtenerAnalista } from "../../api/usuarios";
import { Insignia } from "../../comun/Insignia";
import { useCarga } from "../../comun/useCarga";
import { useTitulo } from "../../comun/useTitulo";
import { AccesoMovil } from "../../usuarios/AccesoMovil";
import { CambiarActivo } from "../../usuarios/CambiarActivo";
import { useAvisoCreado } from "../../usuarios/useAvisoCreado";
import { datosDe, FormularioAnalista, valoresDe } from "./FormularioAnalista";

/** Solo los campos que cambiaron (PATCH). */
export function cambiosDe(antes: Analista, despues: ReturnType<typeof datosDe>): AnalistaCambios {
  const cambios: AnalistaCambios = {};
  if (despues.nombre_completo !== antes.nombre_completo) cambios.nombre_completo = despues.nombre_completo;
  if (despues.dni !== antes.dni) cambios.dni = despues.dni;
  if (despues.celular !== antes.celular) cambios.celular = despues.celular;
  return cambios;
}

export default function AnalistaDetalle() {
  const { id } = useParams();
  const numero = Number(id);
  const valido = Number.isInteger(numero) && numero > 0;
  const { carga, recargar, ponerDatos } = useCarga(
    () => (valido ? obtenerAnalista(numero) : Promise.reject(new ErrorApi(404, "no_encontrado", "El analista no existe"))),
    [numero],
  );
  const [recienCreado, olvidarCreado] = useAvisoCreado();
  const [cambiarActivo, setCambiarActivo] = useState(false);
  useTitulo(carga.estado === "listo" ? carga.datos.nombre_completo : "Analista");

  const miga = <p className="miga"><Link to="/analistas">Analistas</Link> › Detalle</p>;
  if (carga.estado === "cargando") return <>{miga}<p>Cargando analista…</p></>;
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
        <h1>{a.nombre_completo}</h1>
        {!a.activo && <Insignia tono="neutro">Inactivo</Insignia>}
      </div>

      {recienCreado && a.pin_pendiente && (
        <p className="aviso aviso-ok" role="status">
          Analista creado. Está pendiente de activar: genere su código de activación más abajo.
        </p>
      )}

      <section className="seccion" aria-labelledby="datos-titulo">
        <h2 id="datos-titulo">Datos</h2>
        <FormularioAnalista
          key={a.id}
          inicial={valoresDe(a)}
          textoGuardar="Guardar cambios"
          onGuardar={async (v) => {
            olvidarCreado();
            const cambios = cambiosDe(a, datosDe(v));
            if (Object.keys(cambios).length === 0) return "No hay cambios que guardar.";
            ponerDatos(await editarAnalista(a.id, cambios));
            return "Cambios guardados.";
          }}
          extra={
            <button type="button" className={a.activo ? "boton boton-peligro-suave" : "boton boton-secundario"}
                    onClick={() => setCambiarActivo(true)}>
              {a.activo ? "Desactivar analista" : "Reactivar analista"}
            </button>
          }
        />
      </section>

      <AccesoMovil usuario={a} onCambio={recargar} onAccion={olvidarCreado} />

      {cambiarActivo && (
        <CambiarActivo
          rol="analista"
          activo={a.activo}
          onCerrar={() => setCambiarActivo(false)}
          onConfirmar={async () => {
            olvidarCreado();
            ponerDatos(await editarAnalista(a.id, { activo: !a.activo }));
            setCambiarActivo(false);
          }}
        />
      )}
    </>
  );
}
