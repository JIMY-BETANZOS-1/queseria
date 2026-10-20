import { useId, useState } from "react";

import { ErrorSesion } from "../../api/cliente";
import { crearCliente, listarClientes, listarVentas, lotesDisponibles, vender } from "../../api/produccion";
import type { Cliente } from "../../api/tipos";
import { Campo } from "../../comun/Campo";
import { Confirmar } from "../../comun/Confirmar";
import { fecha, hoyLima, primerDiaDelMes, soles } from "../../comun/formato";
import { Modal } from "../../comun/Modal";
import { mensajeDeError, useCarga } from "../../comun/useCarga";
import { useTitulo } from "../../comun/useTitulo";

const CANTIDAD = /^\d{1,8}(\.\d{1,2})?$/;
const unidad = (u: string) => (u === "kilo" ? "kg" : "unid.");

/** Cliente nuevo: solo el nombre es obligatorio; documento y celular, si se escriben, los valida la base. */
function VentanaCliente({ onHecho, onCerrar }: { onHecho: (c: Cliente) => void; onCerrar: () => void }) {
  const id = useId();
  const [nombre, setNombre] = useState("");
  const [documento, setDocumento] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState(false);

  async function guardar() {
    setError(null);
    if (nombre.trim() === "") {
      setError("Escriba el nombre del cliente");
      return;
    }
    setOcupada(true);
    try {
      const doc = documento.trim();
      // Con RUC (11 dígitos) es empresa; con DNI o sin documento, persona natural
      onHecho(await crearCliente({ nombre: nombre.trim(), tipo: doc.length === 11 ? "empresa" : "natural",
                                   documento: doc === "" ? null : doc }));
    } catch (e) {
      if (e instanceof ErrorSesion) return;
      setError(mensajeDeError(e));
      setOcupada(false);
    }
  }

  return (
    <Modal titulo="Nuevo cliente" onCerrar={onCerrar} ocupada={ocupada}
           acciones={<>
             <button type="button" className="boton boton-secundario" onClick={onCerrar} disabled={ocupada}>Cancelar</button>
             <button type="button" className="boton boton-primario" onClick={guardar} disabled={ocupada}>Guardar cliente</button>
           </>}>
      <Campo id={`${id}-nombre`} etiqueta="Nombre o razón social" deshabilitado={ocupada}>
        {(p) => <input {...p} type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} />}
      </Campo>
      <Campo id={`${id}-documento`} etiqueta="DNI o RUC (opcional)" deshabilitado={ocupada}>
        {(p) => <input {...p} type="text" inputMode="numeric" maxLength={11} value={documento} onChange={(e) => setDocumento(e.target.value)} />}
      </Campo>
      {error !== null && <p className="aviso aviso-error" role="alert">{error}</p>}
    </Modal>
  );
}

/** A10 (rápida) · Venta al contado de un lote cerrado con saldo, y las ventas del mes. */
export default function Ventas() {
  useTitulo("Ventas");
  const id = useId();
  const [hoy] = useState(() => hoyLima());
  const clientes = useCarga(listarClientes, []);
  const lotes = useCarga(lotesDisponibles, []);
  const ventas = useCarga(() => listarVentas(primerDiaDelMes(hoy), hoy), [hoy]);
  const [v, setV] = useState({ cliente_id: "", lote_id: "", cantidad: "", precio: "" });
  const [errores, setErrores] = useState<Partial<Record<keyof typeof v, string>>>({});
  const [nuevoCliente, setNuevoCliente] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const listaClientes = clientes.carga.estado === "listo" ? clientes.carga.datos : [];
  // Los vencidos no se pueden vender (la base los rechaza): se muestran aparte, para darles de baja más adelante
  const vendibles = lotes.carga.estado === "listo" ? lotes.carga.datos.filter((l) => !l.vencido) : [];
  const vencidos = lotes.carga.estado === "listo" ? lotes.carga.datos.filter((l) => l.vencido) : [];
  const cliente = listaClientes.find((c) => String(c.id) === v.cliente_id);
  const lote = vendibles.find((l) => String(l.lote_id) === v.lote_id);
  const subtotal = Math.round(Number(v.cantidad) * Number(v.precio) * 100) / 100;

  function elegirLote(loteId: string) {
    const l = vendibles.find((x) => String(x.lote_id) === loteId);
    setV((x) => ({ ...x, lote_id: loteId, precio: l?.precio_venta != null ? String(l.precio_venta) : x.precio }));
    setAviso(null);
  }

  function revisar() {
    const e: typeof errores = {};
    if (!cliente) e.cliente_id = "Elija el cliente";
    if (!lote) e.lote_id = "Elija el lote";
    if (!CANTIDAD.test(v.cantidad.trim()) || Number(v.cantidad) <= 0) e.cantidad = "Cantidad mayor que cero, con hasta 2 decimales";
    else if (lote && Number(v.cantidad) > lote.saldo) e.cantidad = `No puede pasar del saldo del lote (${lote.saldo})`;
    if (!CANTIDAD.test(v.precio.trim())) e.precio = "Precio en soles, 0 o más, con hasta 2 decimales";
    setErrores(e);
    setAviso(null);
    if (Object.keys(e).length === 0) setConfirmar(true);
  }

  return (
    <>
      <div className="encabezado">
        <h1>Ventas</h1>
      </div>
      <p className="texto-suave">Ventas al contado desde lotes cerrados con saldo; el que vence primero aparece arriba.</p>
      {aviso !== null && <p className="aviso aviso-ok" role="status">{aviso}</p>}

      <section className="seccion" aria-labelledby={`${id}-nueva`}>
        <h2 id={`${id}-nueva`}>Nueva venta</h2>
        <div className="formulario-rejilla">
          <Campo id={`${id}-cliente`} etiqueta="Cliente" error={errores.cliente_id}>
            {(p) => (
              <select {...p} value={v.cliente_id} onChange={(e) => setV((x) => ({ ...x, cliente_id: e.target.value }))}>
                <option value="">Elija…</option>
                {listaClientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            )}
          </Campo>
          <Campo id={`${id}-lote`} etiqueta="Lote" error={errores.lote_id}>
            {(p) => (
              <select {...p} value={v.lote_id} onChange={(e) => elegirLote(e.target.value)}>
                <option value="">Elija…</option>
                {vendibles.map((l) => (
                  <option key={l.lote_id} value={l.lote_id}>
                    {l.codigo} · {l.receta} · saldo {l.saldo} {unidad(l.unidad_venta)}
                    {l.fecha_vencimiento ? ` · vence ${fecha(l.fecha_vencimiento)}` : ""}{l.por_vencer ? " (por vencer)" : ""}
                  </option>
                ))}
              </select>
            )}
          </Campo>
          <Campo id={`${id}-cantidad`} etiqueta={`Cantidad${lote ? ` (${unidad(lote.unidad_venta)})` : ""}`} error={errores.cantidad}>
            {(p) => <input {...p} type="text" inputMode="decimal" value={v.cantidad} onChange={(e) => setV((x) => ({ ...x, cantidad: e.target.value }))} />}
          </Campo>
          <Campo id={`${id}-precio`} etiqueta="Precio unitario (S/)" error={errores.precio} ayuda="Se propone el precio de la receta.">
            {(p) => <input {...p} type="text" inputMode="decimal" value={v.precio} onChange={(e) => setV((x) => ({ ...x, precio: e.target.value }))} />}
          </Campo>
        </div>
        <div className="fila-acciones">
          <button type="button" className="boton boton-primario" onClick={revisar}>Registrar venta</button>
          <button type="button" className="boton boton-secundario" onClick={() => setNuevoCliente(true)}>Nuevo cliente</button>
        </div>
        {lotes.carga.estado === "listo" && vendibles.length === 0 && (
          <p className="texto-suave">No hay lotes cerrados con saldo para vender: produzca uno en Producción.</p>
        )}
        {vencidos.length > 0 && (
          <p className="aviso aviso-atencion">
            {vencidos.length === 1 ? "1 lote vencido tiene" : `${vencidos.length} lotes vencidos tienen`} saldo y no se
            puede vender: {vencidos.map((l) => l.codigo).join(", ")}.
          </p>
        )}
      </section>

      <section className="seccion" aria-labelledby={`${id}-mes`}>
        <h2 id={`${id}-mes`}>Ventas del mes</h2>
        {ventas.carga.estado === "error" && (
          <p className="aviso aviso-error" role="alert">
            {ventas.carga.mensaje}{" "}
            <button type="button" className="boton-enlace" onClick={ventas.recargar}>Reintentar</button>
          </p>
        )}
        {ventas.carga.estado === "listo" && (ventas.carga.datos.length === 0 ? <p className="texto-suave">Todavía no hay ventas este mes.</p> : (
          <>
            <p><strong>Total: {soles(ventas.carga.datos.reduce((s, x) => s + x.subtotal, 0))}</strong></p>
            <table className="tabla" aria-label="Ventas del mes">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Cliente</th>
                  <th>Lote</th>
                  <th className="numero">Cantidad</th>
                  <th className="numero">Precio</th>
                  <th className="numero">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {ventas.carga.datos.map((x) => (
                  <tr key={`${x.venta_id}-${x.lote_id}`}>
                    <td>{fecha(x.fecha)}</td>
                    <td>{x.cliente}</td>
                    <td><span className="codigo">{x.codigo_lote}</span> {x.receta}</td>
                    <td className="numero">{x.cantidad}</td>
                    <td className="numero">{soles(x.precio_unitario)}</td>
                    <td className="numero">{soles(x.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ))}
      </section>

      {nuevoCliente && (
        <VentanaCliente onCerrar={() => setNuevoCliente(false)} onHecho={(c) => {
          setNuevoCliente(false);
          clientes.recargar();
          setV((x) => ({ ...x, cliente_id: String(c.id) }));
          setAviso(`Cliente ${c.nombre} registrado.`);
        }} />
      )}

      {confirmar && cliente && lote && (
        <Confirmar
          titulo="Registrar venta"
          textoConfirmar="Registrar venta"
          onCerrar={() => setConfirmar(false)}
          onConfirmar={async () => {
            const venta = await vender({ cliente_id: cliente.id, lote_id: lote.lote_id, cantidad: Number(v.cantidad),
                                         precio_unitario: Number(v.precio) });
            setConfirmar(false);
            setV({ cliente_id: "", lote_id: "", cantidad: "", precio: "" });
            setAviso(`Venta de ${soles(venta.subtotal)} a ${venta.cliente} registrada.`);
            lotes.recargar();
            ventas.recargar();
          }}
        >
          <ul className="lista-avisos">
            <li>{cliente.nombre}: {v.cantidad} {unidad(lote.unidad_venta)} del lote {lote.codigo} ({lote.receta}) a{" "}
              {soles(Number(v.precio))}: <strong>{soles(subtotal)}</strong>, al contado, con fecha de hoy.</li>
            <li>Descuenta el saldo del lote y cuenta en los ingresos del mes.</li>
            <li>No se puede anular desde el panel.</li>
          </ul>
        </Confirmar>
      )}
    </>
  );
}
