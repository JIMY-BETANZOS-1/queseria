import { useId, useState } from "react";

import { ErrorSesion } from "../../api/cliente";
import { registrarMerma } from "../../api/dashboard";
import type { Jornada, Merma } from "../../api/tipos";
import { Campo } from "../../comun/Campo";
import { fecha, litros, nombreMes, soles } from "../../comun/formato";
import { Modal } from "../../comun/Modal";
import { mensajeDeError } from "../../comun/useCarga";

const LITROS = /^\d{1,6}(\.\d{1,2})?$/;   // numeric(8,2)

/**
 * Registrar merma de leche de una jornada: litros (propone lo disponible) y motivo. Que no supere lo aprobado sin
 * destino lo decide la base (fn_merma_leche); su rechazo se muestra tal cual.
 */
export function VentanaMerma({ jornada, onHecho, onCerrar }: {
  jornada: Jornada; onHecho: (m: Merma) => void; onCerrar: () => void;
}) {
  const id = useId();
  const [v, setV] = useState({ litros: String(jornada.litros_disponibles), motivo: "" });
  const [errores, setErrores] = useState<{ litros?: string; motivo?: string }>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState(false);

  const cantidad = Number(v.litros);
  const valido = LITROS.test(v.litros.trim()) && cantidad > 0;

  async function guardar() {
    const e: typeof errores = {};
    if (!valido) e.litros = "Litros mayores que cero, con hasta 2 decimales";
    if (v.motivo.trim() === "") e.motivo = "Escriba el motivo";
    setErrores(e);
    setGeneral(null);
    if (Object.keys(e).length > 0) return;
    setOcupada(true);
    try {
      onHecho(await registrarMerma({ fecha: jornada.fecha, litros: cantidad, motivo: v.motivo.trim() }));
    } catch (err) {
      if (err instanceof ErrorSesion) return;
      setGeneral(mensajeDeError(err));
      setOcupada(false);
    }
  }

  return (
    <Modal titulo={`Registrar merma: jornada del ${fecha(jornada.fecha)}`} onCerrar={onCerrar} ocupada={ocupada}
           acciones={<>
             <button type="button" className="boton boton-secundario" onClick={onCerrar} disabled={ocupada}>Cancelar</button>
             <button type="button" className="boton boton-peligro" onClick={guardar} disabled={ocupada}>
               {ocupada ? "Registrando…" : "Registrar merma"}
             </button>
           </>}>
      <div className="formulario-rejilla">
        <Campo id={`${id}-litros`} etiqueta="Litros perdidos" error={errores.litros} deshabilitado={ocupada}
               ayuda={`Disponible: ${litros(jornada.litros_disponibles)} (aprobada, sin lote ni merma).`}>
          {(p) => <input {...p} type="text" inputMode="decimal" value={v.litros}
                         onChange={(e) => setV((x) => ({ ...x, litros: e.target.value }))} />}
        </Campo>
        <Campo id={`${id}-motivo`} etiqueta="Motivo" error={errores.motivo} deshabilitado={ocupada}
               ayuda="Por ejemplo: se derramó un porongo, se agrió.">
          {(p) => <input {...p} type="text" value={v.motivo} onChange={(e) => setV((x) => ({ ...x, motivo: e.target.value }))} />}
        </Campo>
      </div>
      <ul className="lista-avisos">
        {valido && jornada.costo_litro_util !== null && (
          <li>Pérdida estimada: <strong>{soles(cantidad * jornada.costo_litro_util)}</strong> ({litros(cantidad)} a{" "}
            {soles(jornada.costo_litro_util, 4)} por litro útil), en el resultado de {nombreMes(jornada.fecha)}. La calcula
            la base y cambia si cambia el costo por litro útil de esa jornada.</li>
        )}
        <li>No cambia el flujo de caja: esa leche ya cuenta como pagada.</li>
        <li>La merma no se puede borrar desde el panel.</li>
      </ul>
      {general !== null && <p className="aviso aviso-error" role="alert">{general}</p>}
    </Modal>
  );
}
