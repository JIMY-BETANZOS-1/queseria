import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { ErrorApi } from "../../api/cliente";
import type { Acopiador, AcopiadorCambios } from "../../api/tipos";
import { editarAcopiador, obtenerAcopiador } from "../../api/usuarios";
import { Confirmar } from "../../comun/Confirmar";
import { fecha } from "../../comun/formato";
import { Insignia } from "../../comun/Insignia";
import { MuestraColor } from "../../comun/MuestraColor";
import { useCarga } from "../../comun/useCarga";
import { useTitulo } from "../../comun/useTitulo";
import { AccesoMovil } from "../../usuarios/AccesoMovil";
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
  const ubicacion = useLocation();
  const navegar = useNavigate();
  // El aviso de "recién creado" se apaga con la primera acción: después contradiría el estado actual
  const [recienCreado, setRecienCreado] = useState((ubicacion.state as { creado?: boolean } | null)?.creado === true);
  const [cambiarActivo, setCambiarActivo] = useState(false);

  function olvidarCreado() {
    if (!recienCreado) return;
    setRecienCreado(false);
    // También en el historial: con F5 no vuelve a aparecer
    navegar(ubicacion.pathname, { replace: true, state: null });
  }
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
        <Confirmar
          titulo={a.activo ? "Desactivar acopiador" : "Reactivar acopiador"}
          textoConfirmar={a.activo ? "Desactivar" : "Reactivar"}
          peligro={a.activo}
          onCerrar={() => setCambiarActivo(false)}
          onConfirmar={async () => {
            olvidarCreado();
            ponerDatos(await editarAcopiador(a.id, { activo: !a.activo }));
            setCambiarActivo(false);
          }}
        >
          {a.activo ? (
            <ul className="lista-avisos">
              <li>Corta su acceso al instante: la app ya no podrá entrar ni sincronizar con el servidor.</li>
              <li>Lo que ya registró en el servidor no cambia.</li>
              <li>Lo que tenga sin enviar se queda guardado en su celular: no se borra.</li>
            </ul>
          ) : (
            <ul className="lista-avisos">
              <li>Vuelve a poder entrar y sincronizar.</li>
              <li>
                Si mientras estuvo inactivo intentó entrar con señal, su celular quedó desvinculado: genere un código
                nuevo y actívelo en ese mismo celular (conserva lo que tenga sin enviar).
              </li>
            </ul>
          )}
        </Confirmar>
      )}
    </>
  );
}
