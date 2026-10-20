import { useId, useState } from "react";

import { ErrorSesion } from "../../api/cliente";
import { revisarCalidad, subirFotoAnalisis } from "../../api/recolecciones";
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
const TIPOS_FOTO = ["image/jpeg", "image/png", "image/webp"];

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
  const [ocupada, setOcupada] = useState<false | "foto" | "revision">(false);
  const [foto, setFoto] = useState<File | null>(null);
  const [errorFoto, setErrorFoto] = useState<string | undefined>(undefined);

  async function guardar() {
    setGeneral(null);
    const e: typeof errores = {};
    for (const c of CAMPOS) {
      if (v[c.nombre].trim() !== "" && !NUMERO.test(v[c.nombre].trim())) e[c.nombre] = "Escriba un número (con punto decimal)";
    }
    const conDatos = CAMPOS.some((c) => v[c.nombre].trim() !== "") || v.antibioticos !== "" || foto !== null;
    setErrores(e);
    if (Object.keys(e).length > 0 || errorFoto !== undefined) return;
    if (!conDatos) {
      setGeneral("Escriba al menos un dato del análisis o elija una foto: la leche alterada lo exige.");
      return;
    }
    const datos: CalidadAdmin = { estado: "alterado" };
    for (const c of CAMPOS) if (v[c.nombre].trim() !== "") datos[c.nombre] = Number(v[c.nombre].trim());
    if (v.antibioticos !== "") datos.antibioticos_positivo = v.antibioticos === "si";
    try {
      // Primero la foto: si falla, no se marca alterada
      if (foto !== null) {
        setOcupada("foto");
        await subirFotoAnalisis(r.recoleccion_id, foto);
      }
      setOcupada("revision");
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
      ocupada={ocupada !== false}
      acciones={
        <>
          <button type="button" className="boton boton-secundario" onClick={onCerrar} disabled={ocupada !== false}>Cancelar</button>
          <button type="button" className="boton boton-peligro" onClick={guardar} disabled={ocupada !== false}>
            {ocupada === "foto" ? "Subiendo foto…" : ocupada === "revision" ? "Procesando…" : "Marcar alterada"}
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
          <Campo key={c.nombre} id={`${id}-${c.nombre}`} etiqueta={c.etiqueta} error={errores[c.nombre]} deshabilitado={ocupada !== false}>
            {(p) => (
              <input {...p} type="text" inputMode="decimal" autoComplete="off" value={v[c.nombre]}
                     onChange={(e) => setV((x) => ({ ...x, [c.nombre]: e.target.value }))} />
            )}
          </Campo>
        ))}
        <Campo id={`${id}-antibioticos`} etiqueta="Antibióticos" deshabilitado={ocupada !== false}>
          {(p) => (
            <select {...p} value={v.antibioticos}
                    onChange={(e) => setV((x) => ({ ...x, antibioticos: e.target.value as Valores["antibioticos"] }))}>
              <option value="">Sin dato</option>
              <option value="no">Negativo</option>
              <option value="si">Positivo</option>
            </select>
          )}
        </Campo>
        <Campo id={`${id}-foto`} etiqueta="Foto (opcional)" error={errorFoto} deshabilitado={ocupada !== false}
               ayuda="JPEG, PNG o WebP. Con foto, basta la foto como análisis.">
          {(p) => (
            <input {...p} type="file" accept={TIPOS_FOTO.join(",")}
                   onChange={(e) => {
                     const archivo = e.target.files?.[0] ?? null;
                     setFoto(archivo);
                     setErrorFoto(archivo !== null && !TIPOS_FOTO.includes(archivo.type)
                       ? "La foto debe ser una imagen JPEG, PNG o WebP" : undefined);
                   }} />
          )}
        </Campo>
      </div>
      {foto !== null && errorFoto === undefined && (
        <p className="texto-suave">Foto elegida: {foto.name} ({Math.max(1, Math.round(foto.size / 1024))} KB). Se sube al marcar alterada.</p>
      )}
      {general !== null && <p className="aviso aviso-error" role="alert">{general}</p>}
    </Modal>
  );
}
