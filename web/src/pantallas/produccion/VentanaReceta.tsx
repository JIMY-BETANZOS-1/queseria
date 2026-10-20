import { useId, useState } from "react";

import { ErrorSesion } from "../../api/cliente";
import { cambiarReceta, crearReceta, ponerInsumosReceta } from "../../api/produccion";
import type { InsumoEnReceta, InsumoStock, Receta, RecetaCambios } from "../../api/tipos";
import { Campo } from "../../comun/Campo";
import { litros, soles } from "../../comun/formato";
import { Modal } from "../../comun/Modal";
import { mensajeDeError } from "../../comun/useCarga";
import { alcanceReceta } from "./alcance";

const DECIMAL2 = /^\d{1,8}(\.\d{1,2})?$/;
const DECIMAL3 = /^\d{1,9}(\.\d{1,3})?$/;
const ENTERO = /^\d{1,5}$/;

type Fila = { clave: number; insumo_id: string; cantidad: string };
type Valores = {
  nombre: string; unidad_venta: "unidad" | "kilo"; precio_venta: string; litros_base: string;
  rendimiento_base: string; dias_vida_util: string; activa: boolean;
};
type Errores = Partial<Record<keyof Valores, string>> & { filas?: Record<number, { insumo?: string; cantidad?: string }> };

// Con lotes ya hechos no cambian (el backend responde 409): alterarían el teórico, el vencimiento o la unidad de esos lotes
const PROTEGIDOS: (keyof Valores)[] = ["unidad_venta", "litros_base", "rendimiento_base", "dias_vida_util"];

const texto = (n: number | null) => (n === null ? "" : String(n));
const numero = (s: string) => (s.trim() === "" ? null : Number(s.trim()));

function valoresDe(r: Receta | undefined, copia: boolean): Valores {
  if (!r) return { nombre: "", unidad_venta: "unidad", precio_venta: "", litros_base: "100", rendimiento_base: "", dias_vida_util: "", activa: true };
  return { nombre: copia ? `${r.nombre} (copia)` : r.nombre, unidad_venta: r.unidad_venta, precio_venta: texto(r.precio_venta),
           litros_base: String(r.litros_base), rendimiento_base: texto(r.rendimiento_base), dias_vida_util: texto(r.dias_vida_util),
           activa: copia ? true : r.activa };
}

/**
 * Crear (también "Duplicar como nueva", con los datos de otra receta) o editar una receta: cabecera y tabla de insumos
 * por litros base, con vista previa del costo de insumos por 100 L y de para cuánta leche alcanza el stock de hoy.
 */
export function VentanaReceta({ modo, receta, insumos, onHecho, onCerrar }: {
  modo: "crear" | "editar"; receta?: Receta; insumos: InsumoStock[];
  onHecho: (r: Receta) => void; onCerrar: () => void;
}) {
  const id = useId();
  const [v, setV] = useState<Valores>(() => valoresDe(receta, modo === "crear"));
  const [filas, setFilas] = useState<Fila[]>(() => (receta?.insumos ?? []).map((i, n) => (
    { clave: n, insumo_id: String(i.insumo_id), cantidad: String(i.cantidad) })));
  const [siguiente, setSiguiente] = useState(() => (receta?.insumos.length ?? 0));
  const [errores, setErrores] = useState<Errores>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState(false);
  const conLotes = modo === "editar" && (receta?.n_lotes ?? 0) > 0;

  // Insumos elegibles: los del almacén y, al editar, también los que ya tenga la receta aunque no estén en él
  const opciones = new Map(insumos.map((i) => [i.insumo_id, { nombre: i.nombre, unidad: i.unidad, costo: i.costo_unitario, stock: i.stock }]));
  for (const i of receta?.insumos ?? []) {
    if (!opciones.has(i.insumo_id)) opciones.set(i.insumo_id, { nombre: i.nombre, unidad: i.unidad, costo: 0, stock: 0 });
  }

  const litrosBase = DECIMAL2.test(v.litros_base.trim()) && Number(v.litros_base) > 0 ? Number(v.litros_base) : null;
  const validas = filas.filter((f) => f.insumo_id !== "" && DECIMAL3.test(f.cantidad.trim()) && Number(f.cantidad) > 0);
  const por100 = (cantidad: number) => (litrosBase === null ? 0 : (cantidad / litrosBase) * 100);
  const costoPor100 = Math.round(validas.reduce((s, f) => s + por100(Number(f.cantidad)) * (opciones.get(Number(f.insumo_id))?.costo ?? 0), 0) * 100) / 100;
  const alcance = litrosBase === null ? null : alcanceReceta(
    { id: 0, nombre: v.nombre, litros_base: litrosBase,
      insumos: validas.map((f) => ({ insumo_id: Number(f.insumo_id), nombre: "", unidad: "", cantidad: Number(f.cantidad) })) },
    new Map([...opciones].map(([k, o]) => [k, o.stock])));

  function cambiarFila(clave: number, cambio: Partial<Fila>) {
    setFilas((fs) => fs.map((f) => (f.clave === clave ? { ...f, ...cambio } : f)));
  }

  async function guardar() {
    const e: Errores = {};
    if (v.nombre.trim() === "") e.nombre = "Escriba el nombre";
    if (v.precio_venta.trim() !== "" && !DECIMAL2.test(v.precio_venta.trim())) e.precio_venta = "Un monto con hasta 2 decimales";
    if (litrosBase === null) e.litros_base = "Litros mayores que cero, con hasta 2 decimales";
    if (v.rendimiento_base.trim() !== "" && !DECIMAL2.test(v.rendimiento_base.trim())) e.rendimiento_base = "Un número con hasta 2 decimales";
    if (v.dias_vida_util.trim() !== "" && !ENTERO.test(v.dias_vida_util.trim())) e.dias_vida_util = "Días enteros";
    const ef: NonNullable<Errores["filas"]> = {};
    for (const f of filas) {
      const ff: { insumo?: string; cantidad?: string } = {};
      if (f.insumo_id === "") ff.insumo = "Elija el insumo";
      if (!DECIMAL3.test(f.cantidad.trim()) || Number(f.cantidad) <= 0) ff.cantidad = "Cantidad mayor que cero, con hasta 3 decimales";
      if (ff.insumo || ff.cantidad) ef[f.clave] = ff;
    }
    if (Object.keys(ef).length > 0) e.filas = ef;
    setErrores(e);
    setGeneral(null);
    if (Object.keys(e).length > 0) return;

    const cabecera = {
      nombre: v.nombre.trim(), unidad_venta: v.unidad_venta, precio_venta: numero(v.precio_venta), litros_base: Number(v.litros_base),
      rendimiento_base: numero(v.rendimiento_base), dias_vida_util: numero(v.dias_vida_util), activa: v.activa,
    };
    const lista: InsumoEnReceta[] = filas.map((f) => ({ insumo_id: Number(f.insumo_id), cantidad: Number(f.cantidad) }));
    setOcupada(true);
    try {
      if (modo === "crear") {
        onHecho(await crearReceta({ ...cabecera, insumos: lista }));
        return;
      }
      const r = receta!;
      const cambios: RecetaCambios = {};
      for (const [k, valor] of Object.entries(cabecera) as [keyof typeof cabecera, unknown][]) {
        if (valor !== r[k]) (cambios as Record<string, unknown>)[k] = valor;
      }
      const clave = (xs: { insumo_id: number; cantidad: number }[]) =>
        JSON.stringify([...xs].map((x) => [x.insumo_id, x.cantidad]).sort((a, b) => a[0]! - b[0]!));
      const cambianInsumos = clave(lista) !== clave(r.insumos);
      if (Object.keys(cambios).length === 0 && !cambianInsumos) {
        setGeneral("No hay cambios que guardar.");
        setOcupada(false);
        return;
      }
      let final = r;
      if (Object.keys(cambios).length > 0) final = await cambiarReceta(r.id, cambios);
      if (cambianInsumos) final = await ponerInsumosReceta(r.id, lista);
      onHecho(final);
    } catch (err) {
      if (err instanceof ErrorSesion) return;
      setGeneral(mensajeDeError(err));
      setOcupada(false);
    }
  }

  const unidadRend = v.unidad_venta === "kilo" ? "kilos" : "unidades";
  const titulo = modo === "editar" ? `Editar receta: ${receta!.nombre}` : receta ? `Nueva receta (copia de ${receta.nombre})` : "Nueva receta";
  const protegido = (k: keyof Valores) => ocupada || (conLotes && PROTEGIDOS.includes(k));

  return (
    <Modal titulo={titulo} onCerrar={onCerrar} ocupada={ocupada}
           acciones={<>
             <button type="button" className="boton boton-secundario" onClick={onCerrar} disabled={ocupada}>Cancelar</button>
             <button type="button" className="boton boton-primario" onClick={guardar} disabled={ocupada}>
               {ocupada ? "Guardando…" : modo === "editar" ? "Guardar cambios" : "Crear receta"}
             </button>
           </>}>
      {conLotes && (
        <p className="aviso aviso-atencion">
          Esta receta ya tiene {receta!.n_lotes === 1 ? "1 lote" : `${receta!.n_lotes} lotes`}: la unidad de venta, los litros
          base, el rendimiento y la vida útil no se cambian, porque alterarían lo que se muestra de esos lotes. Para
          cambiarlos, use «Duplicar como nueva» y desactive esta.
        </p>
      )}
      <div className="formulario-rejilla">
        <Campo id={`${id}-nombre`} etiqueta="Nombre" error={errores.nombre} deshabilitado={ocupada}>
          {(p) => <input {...p} type="text" value={v.nombre} onChange={(e) => setV((x) => ({ ...x, nombre: e.target.value }))} />}
        </Campo>
        <Campo id={`${id}-unidad`} etiqueta="Se vende por" deshabilitado={protegido("unidad_venta")}>
          {(p) => (
            <select {...p} value={v.unidad_venta} onChange={(e) => setV((x) => ({ ...x, unidad_venta: e.target.value as Valores["unidad_venta"] }))}>
              <option value="unidad">Unidad (quesos)</option>
              <option value="kilo">Kilo (yogurt)</option>
            </select>
          )}
        </Campo>
        <Campo id={`${id}-precio`} etiqueta="Precio de venta (S/, opcional)" error={errores.precio_venta} deshabilitado={ocupada}>
          {(p) => <input {...p} type="text" inputMode="decimal" value={v.precio_venta} onChange={(e) => setV((x) => ({ ...x, precio_venta: e.target.value }))} />}
        </Campo>
        <Campo id={`${id}-litros`} etiqueta="Litros base" error={errores.litros_base} deshabilitado={protegido("litros_base")}
               ayuda="Las cantidades de insumos y el rendimiento son para estos litros de leche.">
          {(p) => <input {...p} type="text" inputMode="decimal" value={v.litros_base} onChange={(e) => setV((x) => ({ ...x, litros_base: e.target.value }))} />}
        </Campo>
        <Campo id={`${id}-rendimiento`} etiqueta={`Rendimiento (${unidadRend}, opcional)`} error={errores.rendimiento_base}
               deshabilitado={protegido("rendimiento_base")}>
          {(p) => <input {...p} type="text" inputMode="decimal" value={v.rendimiento_base} onChange={(e) => setV((x) => ({ ...x, rendimiento_base: e.target.value }))} />}
        </Campo>
        <Campo id={`${id}-vida`} etiqueta="Vida útil (días, opcional)" error={errores.dias_vida_util} deshabilitado={protegido("dias_vida_util")}>
          {(p) => <input {...p} type="text" inputMode="numeric" value={v.dias_vida_util} onChange={(e) => setV((x) => ({ ...x, dias_vida_util: e.target.value }))} />}
        </Campo>
      </div>
      <label className="casilla">
        <input type="checkbox" checked={v.activa} disabled={ocupada} onChange={(e) => setV((x) => ({ ...x, activa: e.target.checked }))} />
        {" "}Activa (se puede producir con ella)
      </label>

      <h3>Insumos por {litrosBase === null ? "—" : litros(litrosBase)} de leche</h3>
      {filas.length === 0 ? <p className="texto-suave">Sin insumos.</p> : (
        <table className="tabla" aria-label="Insumos de la receta">
          <thead>
            <tr><th>Insumo</th><th className="numero">Cantidad</th><th>Unidad</th><th className="numero">Costo por 100 L</th><th><span className="solo-lector">Quitar</span></th></tr>
          </thead>
          <tbody>
            {filas.map((f, n) => {
              const o = f.insumo_id === "" ? undefined : opciones.get(Number(f.insumo_id));
              const ef = errores.filas?.[f.clave];
              const usados = new Set(filas.filter((x) => x.clave !== f.clave).map((x) => x.insumo_id));
              const cantidadValida = DECIMAL3.test(f.cantidad.trim()) && Number(f.cantidad) > 0;
              return (
                <tr key={f.clave}>
                  <td>
                    <select aria-label={`Insumo ${n + 1}`} value={f.insumo_id} disabled={ocupada} aria-invalid={ef?.insumo ? true : undefined}
                            aria-describedby={ef?.insumo ? `${id}-fila-${f.clave}-insumo` : undefined}
                            onChange={(e) => cambiarFila(f.clave, { insumo_id: e.target.value })}>
                      <option value="">Elija…</option>
                      {[...opciones].map(([k, op]) => (
                        <option key={k} value={String(k)} disabled={usados.has(String(k))}>{op.nombre}</option>
                      ))}
                    </select>
                    {ef?.insumo && <span id={`${id}-fila-${f.clave}-insumo`} className="campo-error">{ef.insumo}</span>}
                  </td>
                  <td className="numero">
                    <input type="text" inputMode="decimal" aria-label={`Cantidad del insumo ${n + 1}`} value={f.cantidad} disabled={ocupada}
                           aria-invalid={ef?.cantidad ? true : undefined}
                           aria-describedby={ef?.cantidad ? `${id}-fila-${f.clave}-cantidad` : undefined}
                           onChange={(e) => cambiarFila(f.clave, { cantidad: e.target.value })} />
                    {ef?.cantidad && <span id={`${id}-fila-${f.clave}-cantidad`} className="campo-error">{ef.cantidad}</span>}
                  </td>
                  <td>{o?.unidad ?? ""}</td>
                  <td className="numero">{o && cantidadValida && litrosBase !== null ? soles(por100(Number(f.cantidad)) * o.costo) : "—"}</td>
                  <td>
                    <button type="button" className="boton-enlace" aria-label={`Quitar insumo ${n + 1}`} disabled={ocupada}
                            onClick={() => setFilas((fs) => fs.filter((x) => x.clave !== f.clave))}>
                      Quitar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <button type="button" className="boton boton-secundario" disabled={ocupada}
              onClick={() => { setFilas((fs) => [...fs, { clave: siguiente, insumo_id: "", cantidad: "" }]); setSiguiente((s) => s + 1); }}>
        Agregar insumo
      </button>

      <p className="vista-previa" aria-live="polite">
        Vista previa: insumos por 100 L <strong>{soles(costoPor100)}</strong>
        {" · "}{alcance === null ? "sin insumos para calcular el alcance" : <>con el stock de hoy alcanza para <strong>≈ {litros(alcance)}</strong> de leche</>}
        {litrosBase !== null && v.rendimiento_base.trim() !== "" && DECIMAL2.test(v.rendimiento_base.trim()) && (
          <>{" · "}rinde {Math.round((Number(v.rendimiento_base) / litrosBase) * 100 * 100) / 100} {unidadRend} por 100 L</>
        )}
      </p>
      <p className="texto-suave">Solo afecta a la producción que viene: los lotes ya hechos conservan su consumo y su costo.</p>
      {general !== null && <p className="aviso aviso-error" role="alert">{general}</p>}
    </Modal>
  );
}
