import { useState } from "react";

import type { CodigoActivacion, Dispositivo, UsuarioMovil } from "../api/tipos";
import { desactivarDispositivo, generarCodigo, listarDispositivos } from "../api/usuarios";
import { Confirmar } from "../comun/Confirmar";
import { fechaHoraLima } from "../comun/formato";
import { Insignia } from "../comun/Insignia";
import { useCarga } from "../comun/useCarga";
import { CodigoVentana } from "./CodigoVentana";
import { estadoAcceso } from "./estadoAcceso";

type Props = {
  usuario: Pick<UsuarioMovil, "id" | "rol" | "nombre_completo" | "activo" | "pin_bloqueado" | "pin_pendiente" | "celular_vinculado">;
  /** Algo cambió en el acceso (código usado, celular desactivado): recargar los datos del usuario. */
  onCambio: () => void;
  /** Se confirmó una acción (generar código, desactivar celular), aunque falle. */
  onAccion?: () => void;
};

/**
 * Acceso a la app móvil de un acopiador o analista: estado, código de activación y celulares.
 * Los textos de las confirmaciones describen lo que hacen el backend (routers/auth.py, routers/usuarios.py,
 * deps.py) y la app (Autenticador.desvincular solo borra la sesión; lo sin enviar sigue en Room).
 */
export function AccesoMovil({ usuario, onCambio, onAccion }: Props) {
  const celulares = useCarga(() => listarDispositivos(usuario.id), [usuario.id]);
  const [confirmarCodigo, setConfirmarCodigo] = useState(false);
  const [codigo, setCodigo] = useState<CodigoActivacion | null>(null);
  const [aDesactivar, setADesactivar] = useState<Dispositivo | null>(null);
  const estado = estadoAcceso(usuario);

  function cerrarCodigo() {
    setCodigo(null);          // el código se descarta aquí
    celulares.recargar();
    onCambio();
  }

  return (
    <section className="seccion" aria-labelledby="acceso-titulo">
      <h2 id="acceso-titulo">Acceso al celular</h2>
      {usuario.rol === "analista" && (
        // MotorSync.bajar (app 0.7.0) rechaza cualquier rol que no sea acopiador
        <p className="aviso aviso-atencion">
          La app actual (0.7.0) todavía no tiene las pantallas del analista: puede activar el celular, pero al
          sincronizar verá "Esta versión de la app es solo para acopiadores".
        </p>
      )}
      <div className="fila-acciones">
        <span>Estado: <Insignia tono={estado.tono}>{estado.texto}</Insignia></span>
        <button
          type="button"
          className="boton boton-primario"
          onClick={() => setConfirmarCodigo(true)}
          disabled={!usuario.activo}
        >
          Generar código de activación
        </button>
      </div>
      {!usuario.activo && (
        <p className="texto-suave">Reactive al usuario para generar un código: un usuario inactivo no puede activar su celular.</p>
      )}

      <h3>Celulares</h3>
      {celulares.carga.estado === "cargando" && <p>Cargando celulares…</p>}
      {celulares.carga.estado === "error" && (
        <p className="aviso aviso-error" role="alert">
          {celulares.carga.mensaje}{" "}
          <button type="button" className="boton-enlace" onClick={celulares.recargar}>Reintentar</button>
        </p>
      )}
      {celulares.carga.estado === "listo" && (celulares.carga.datos.length === 0 ? (
        <p className="texto-suave">Todavía no activó ningún celular.</p>
      ) : (
        <table className="tabla">
          <thead>
            <tr>
              <th>Modelo</th>
              <th>Identificador</th>
              <th>Activado</th>
              <th>Último acceso</th>
              <th>Estado</th>
              <th><span className="solo-lector">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {celulares.carga.datos.map((d) => (
              <tr key={d.id}>
                <td>{d.modelo ?? "Sin modelo"}</td>
                <td><code title="Primeros 8 caracteres del identificador del celular">{d.device_uuid.slice(0, 8)}</code></td>
                <td>{fechaHoraLima(d.activado_en)}</td>
                <td>{d.ultimo_acceso ? fechaHoraLima(d.ultimo_acceso) : "Nunca"}</td>
                <td>{d.activo ? <Insignia tono="ok">Activo</Insignia> : <Insignia tono="neutro">Desactivado</Insignia>}</td>
                <td>
                  {d.activo && (
                    <button type="button" className="boton boton-secundario" onClick={() => setADesactivar(d)}>
                      Desactivar celular
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}

      {confirmarCodigo && (
        <Confirmar
          titulo="Generar código de activación"
          textoConfirmar="Generar código"
          onCerrar={() => setConfirmarCodigo(false)}
          onConfirmar={async () => {
            onAccion?.();
            const nuevo = await generarCodigo(usuario.id);
            setConfirmarCodigo(false);
            setCodigo(nuevo);
          }}
        >
          <ul className="lista-avisos">
            <li>Si había un código anterior sin usar, deja de servir.</li>
            {usuario.celular_vinculado && (
              <li>
                Ya tiene un celular activo. Cuando se use este código, ese celular pasa a ser el único activo: si es
                otro aparato, el actual deja de funcionar. Si es el mismo (por ejemplo, olvidó su PIN), conserva lo
                que tiene guardado, también lo que le falte enviar.
              </li>
            )}
          </ul>
        </Confirmar>
      )}

      {codigo !== null && <CodigoVentana nombre={usuario.nombre_completo} codigo={codigo} onCerrar={cerrarCodigo} />}

      {aDesactivar !== null && (
        <Confirmar
          titulo="Desactivar celular"
          textoConfirmar="Desactivar celular"
          peligro
          onCerrar={() => setADesactivar(null)}
          onConfirmar={async () => {
            onAccion?.();
            await desactivarDispositivo(aDesactivar.id);
            setADesactivar(null);
            celulares.recargar();
            onCambio();
          }}
        >
          <ul className="lista-avisos">
            <li>Este celular ({aDesactivar.modelo ?? "sin modelo"}) deja de poder entrar y sincronizar al instante.</li>
            <li>Lo que tenga sin enviar se queda guardado en el celular: no se borra.</li>
            <li>Para volver a usarlo, genere un código nuevo y actívelo en ese mismo celular.</li>
          </ul>
        </Confirmar>
      )}
    </section>
  );
}
