import { useId, useState } from "react";

import { ErrorSesion } from "../../api/cliente";
import { revisarCalidad } from "../../api/recolecciones";
import type { CalidadAdmin, CalidadRevisada, RecoleccionDetalle } from "../../api/tipos";
import { Campo } from "../../comun/Campo";
import { fechaHoraLima, litros } from "../../comun/formato";
import { Modal } from "../../comun/Modal";
import { mensajeDeError } from "../../comun/useCarga";

type Valores = { ph: string; temperatura_c: string; grasa_pct: string; densidad: string; antibioticos: "" | "si" | "no" };
const CAMPOS: { nombre: Exclude<keyof Valores, "antibioticos">; etiqueta: string }[] = [
  { nombre: "ph", etiqueta: "pH" },
  { nombre: "temperatura_c", etiqueta: "Temperatura (°C)" },
  { nombre: "grasa_pct", etiqueta: "Grasa (%)" },
  { nombre: "densidad", etiqueta: "Densidad" },
];
const NUMERO = /^-?\d+(\.\d+)?$/;

type Props = {
  recoleccion: RecoleccionDetalle;
  onHecho: (resultado: CalidadRevisada) => void;
  onCerrar: () => void;
};

/**
 * Marcar alterada con su análisis. Los textos describen la base: fn_exigir_analisis (al menos un dato),
 * v_recoleccion_pago (el monto de la alterada sigue pagar_leche_alterada) y fn_aplicar_sancion (sanción desde
 * mañana; reincidencia → bloqueo). Los rangos (pH 0–14, grasa 0–100) los valida la base.
 */
export function AlteradaVentana({ recoleccion: r, onHecho, onCerrar }: Props) {
  const id = useId();
  const [v, setV] = useState<Valores>({ ph: "", temperatura_c: "", grasa_pct: "", densidad: "", antibioticos: "" });
  const [errores, setErrores] = useState<Partial<Record<keyof Valores, string>>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState(false);

  async function guardar() {
    setGeneral(null);
    const e: typeof errores = {};
    for (const c of CAMPOS) {
      if (v[c.nombre].trim() !== "" && !NUMERO.test(v[c.nombre].trim())) e[c.nombre] = "Escriba un número (con punto decimal)";
    }
    const conDatos = CAMPOS.some((c) => v[c.nombre].trim() !== "") || v.antibioticos !== "";
    setErrores(e);
    if (Object.keys(e).length > 0) return;
    if (!conDatos) {
      setGeneral("Escriba al menos un dato del análisis: la leche alterada lo exige.");
      return;
    }
    const datos: CalidadAdmin = { estado: "alterado" };
    for (const c of CAMPOS) if (v[c.nombre].trim() !== "") datos[c.nombre] = Number(v[c.nombre].trim());
    if (v.antibioticos !== "") datos.antibioticos_positivo = v.antibioticos === "si";
    setOcupada(true);
    try {
      onHecho(await revisarCalidad(r.recoleccion_id, datos));
    } catch (err) {
      if (err instanceof ErrorSesion) return;
      setGeneral(mensajeDeError(err));
      setOcupada(false);
    }
  }

  return (
    <Modal
      titulo="Marcar como alterada"
      onCerrar={onCerrar}
      ocupada={ocupada}
      acciones={
        <>
          <button type="button" className="boton boton-secundario" onClick={onCerrar} disabled={ocupada}>Cancelar</button>
          <button type="button" className="boton boton-peligro" onClick={guardar} disabled={ocupada}>
            {ocupada ? "Procesando…" : "Marcar alterada"}
          </button>
        </>
      }
    >
      <p className="texto-suave">
        {r.productor} <span className="codigo">({r.productor_codigo})</span> · {litros(r.litros)} · {fechaHoraLima(r.registrada_en)} · registró{" "}
        {r.registrado_por_nombre}
      </p>
      <ul className="lista-avisos">
        <li>La leche alterada se descarta. Su pago sigue la configuración "Pagar leche alterada" (por defecto, se paga).</li>
        <li>
          El productor queda sancionado desde mañana con el precio de sanción; si ya estaba sancionado o la sanción
          terminó hace poco, queda bloqueado. Lo calcula la base.
        </li>
        <li>Queda revisada a su nombre. No se puede deshacer desde el panel.</li>
      </ul>
      <div className="formulario-rejilla">
        {CAMPOS.map((c) => (
          <Campo key={c.nombre} id={`${id}-${c.nombre}`} etiqueta={c.etiqueta} error={errores[c.nombre]} deshabilitado={ocupada}>
            {(p) => (
              <input {...p} type="text" inputMode="decimal" autoComplete="off" value={v[c.nombre]}
                     onChange={(e) => setV((x) => ({ ...x, [c.nombre]: e.target.value }))} />
            )}
          </Campo>
        ))}
        <Campo id={`${id}-antibioticos`} etiqueta="Antibióticos" deshabilitado={ocupada}>
          {(p) => (
            <select {...p} value={v.antibioticos}
                    onChange={(e) => setV((x) => ({ ...x, antibioticos: e.target.value as Valores["antibioticos"] }))}>
              <option value="">Sin dato</option>
              <option value="no">Negativo</option>
              <option value="si">Positivo</option>
            </select>
          )}
        </Campo>
      </div>
      {general !== null && <p className="aviso aviso-error" role="alert">{general}</p>}
    </Modal>
  );
}
