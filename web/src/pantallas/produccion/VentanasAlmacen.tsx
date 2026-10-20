import { useId, useState } from "react";

import { ErrorSesion } from "../../api/cliente";
import { crearInsumo, registrarCompra } from "../../api/produccion";
import type { IngresoRegistrado, InsumoStock } from "../../api/tipos";
import { Campo } from "../../comun/Campo";
import { fecha, hoyLima, soles } from "../../comun/formato";
import { Modal } from "../../comun/Modal";
import { mensajeDeError } from "../../comun/useCarga";

const CANTIDAD = /^\d{1,9}(\.\d{1,3})?$/;   // numeric(12,3)
const COSTO = /^\d{1,8}(\.\d{1,4})?$/;      // numeric(12,4)
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const UNIDADES = [
  { valor: "kg", texto: "Kilos (kg)" }, { valor: "g", texto: "Gramos (g)" }, { valor: "l", texto: "Litros (l)" },
  { valor: "ml", texto: "Mililitros (ml)" }, { valor: "unidad", texto: "Unidades" },
] as const;

/**
 * Costo promedio después de la compra, para mostrarlo antes de confirmar: la misma fórmula que aplica
 * fn_movimiento_insumo (un stock negativo cuenta como 0). Lo que vale es lo que devuelve la base.
 */
export function costoPromedioNuevo(stock: number, costo: number, cantidad: number, costoCompra: number): number {
  const base = Math.max(stock, 0);
  return Math.round(((base * costo + cantidad * costoCompra) / (base + cantidad)) * 10000) / 10000;
}

/** Registrar una compra de un insumo: cantidad, costo por unidad, fecha y nota. */
export function VentanaCompra({ insumo, onHecho, onCerrar }: {
  insumo: InsumoStock; onHecho: (r: IngresoRegistrado) => void; onCerrar: () => void;
}) {
  const id = useId();
  const [hoy] = useState(() => hoyLima());
  const [v, setV] = useState({ cantidad: "", costo: "", fecha: hoy, nota: "" });
  const [errores, setErrores] = useState<Partial<Record<keyof typeof v, string>>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState(false);

  const cantidad = Number(v.cantidad);
  const costo = Number(v.costo);
  const valido = CANTIDAD.test(v.cantidad.trim()) && cantidad > 0 && COSTO.test(v.costo.trim()) && costo > 0;
  const stockNuevo = Math.round((Math.max(insumo.stock, 0) + cantidad) * 1000) / 1000;

  async function guardar() {
    const e: typeof errores = {};
    if (!CANTIDAD.test(v.cantidad.trim()) || cantidad <= 0) e.cantidad = "Cantidad mayor que cero, con hasta 3 decimales";
    if (!COSTO.test(v.costo.trim()) || costo <= 0) e.costo = "Costo mayor que cero, con hasta 4 decimales";
    if (!FECHA.test(v.fecha) || v.fecha > hoy) e.fecha = "Elija una fecha que no sea futura";
    setErrores(e);
    setGeneral(null);
    if (Object.keys(e).length > 0) return;
    setOcupada(true);
    try {
      onHecho(await registrarCompra(insumo.insumo_id, {
        cantidad, costo_unitario: costo, fecha: v.fecha === hoy ? null : v.fecha, nota: v.nota.trim() === "" ? null : v.nota.trim(),
      }));
    } catch (err) {
      if (err instanceof ErrorSesion) return;
      setGeneral(mensajeDeError(err));
      setOcupada(false);
    }
  }

  return (
    <Modal titulo={`Registrar compra: ${insumo.nombre}`} onCerrar={onCerrar} ocupada={ocupada}
           acciones={<>
             <button type="button" className="boton boton-secundario" onClick={onCerrar} disabled={ocupada}>Cancelar</button>
             <button type="button" className="boton boton-primario" onClick={guardar} disabled={ocupada}>
               {ocupada ? "Registrando…" : "Registrar compra"}
             </button>
           </>}>
      <div className="formulario-rejilla">
        <Campo id={`${id}-cantidad`} etiqueta={`Cantidad (${insumo.unidad})`} error={errores.cantidad} deshabilitado={ocupada}>
          {(p) => <input {...p} type="text" inputMode="decimal" value={v.cantidad} onChange={(e) => setV((x) => ({ ...x, cantidad: e.target.value }))} />}
        </Campo>
        <Campo id={`${id}-costo`} etiqueta={`Costo por ${insumo.unidad} (S/)`} error={errores.costo} deshabilitado={ocupada}>
          {(p) => <input {...p} type="text" inputMode="decimal" value={v.costo} onChange={(e) => setV((x) => ({ ...x, costo: e.target.value }))} />}
        </Campo>
        <Campo id={`${id}-fecha`} etiqueta="Fecha de la compra" error={errores.fecha} deshabilitado={ocupada}>
          {(p) => <input {...p} type="date" max={hoy} value={v.fecha} onChange={(e) => setV((x) => ({ ...x, fecha: e.target.value }))} />}
        </Campo>
        <Campo id={`${id}-nota`} etiqueta="Nota (opcional)" ayuda="Por ejemplo, el número de la factura." deshabilitado={ocupada}>
          {(p) => <input {...p} type="text" value={v.nota} onChange={(e) => setV((x) => ({ ...x, nota: e.target.value }))} />}
        </Campo>
      </div>
      <ul className="lista-avisos">
        {valido ? (
          <>
            <li>El stock sube de {Math.max(insumo.stock, 0)} a <strong>{stockNuevo} {insumo.unidad}</strong>
              {" "}(compra de {soles(cantidad * costo)}).</li>
            <li>Costo promedio: de {soles(insumo.costo_unitario, 4)} a <strong>{soles(costoPromedioNuevo(insumo.stock, insumo.costo_unitario, cantidad, costo), 4)}</strong>
              {" "}por {insumo.unidad} (lo recalcula la base).</li>
          </>
        ) : <li>Escriba la cantidad y el costo para ver cómo cambian el stock y el costo promedio.</li>}
        <li>Cuenta en el flujo de caja del {v.fecha === hoy ? "mes" : `mes del ${FECHA.test(v.fecha) ? fecha(v.fecha) : "día elegido"}`} como compra de
          insumos; en el resultado entra recién cuando el insumo se usa en un lote vendido.</li>
        <li>El movimiento no se puede borrar desde el panel.</li>
      </ul>
      {general !== null && <p className="aviso aviso-error" role="alert">{general}</p>}
    </Modal>
  );
}

/** Insumo nuevo: nombre y unidad. Nace sin stock. */
export function VentanaInsumoNuevo({ onHecho, onCerrar }: { onHecho: (i: InsumoStock) => void; onCerrar: () => void }) {
  const id = useId();
  const [nombre, setNombre] = useState("");
  const [unidad, setUnidad] = useState("");
  const [errores, setErrores] = useState<{ nombre?: string; unidad?: string }>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState(false);

  async function guardar() {
    const e: typeof errores = {};
    if (nombre.trim() === "") e.nombre = "Escriba el nombre";
    if (unidad === "") e.unidad = "Elija la unidad";
    setErrores(e);
    setGeneral(null);
    if (Object.keys(e).length > 0) return;
    setOcupada(true);
    try {
      onHecho(await crearInsumo({ nombre: nombre.trim(), unidad: unidad as (typeof UNIDADES)[number]["valor"] }));
    } catch (err) {
      if (err instanceof ErrorSesion) return;
      setGeneral(mensajeDeError(err));
      setOcupada(false);
    }
  }

  return (
    <Modal titulo="Nuevo insumo" onCerrar={onCerrar} ocupada={ocupada}
           acciones={<>
             <button type="button" className="boton boton-secundario" onClick={onCerrar} disabled={ocupada}>Cancelar</button>
             <button type="button" className="boton boton-primario" onClick={guardar} disabled={ocupada}>Crear insumo</button>
           </>}>
      <Campo id={`${id}-nombre`} etiqueta="Nombre" error={errores.nombre} deshabilitado={ocupada}>
        {(p) => <input {...p} type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} />}
      </Campo>
      <Campo id={`${id}-unidad`} etiqueta="Unidad" error={errores.unidad} deshabilitado={ocupada}
             ayuda="La de las compras y las recetas; no se cambia después.">
        {(p) => (
          <select {...p} value={unidad} onChange={(e) => setUnidad(e.target.value)}>
            <option value="">Elija…</option>
            {UNIDADES.map((u) => <option key={u.valor} value={u.valor}>{u.texto}</option>)}
          </select>
        )}
      </Campo>
      <p className="texto-suave">Nace sin stock: su costo promedio lo fija la primera compra.</p>
      {general !== null && <p className="aviso aviso-error" role="alert">{general}</p>}
    </Modal>
  );
}
