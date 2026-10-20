import { useId, useState } from "react";

import { ErrorSesion } from "../../api/cliente";
import { editarParametro, historialPrecios, listarParametros, nuevoPrecio } from "../../api/configuracion";
import type { Parametro, Precio } from "../../api/tipos";
import { Campo } from "../../comun/Campo";
import { Confirmar } from "../../comun/Confirmar";
import { fecha, fechaHoraLima, hoyLima, soles } from "../../comun/formato";
import { Insignia } from "../../comun/Insignia";
import { Modal } from "../../comun/Modal";
import { mensajeDeError, useCarga } from "../../comun/useCarga";
import { useTitulo } from "../../comun/useTitulo";
import { efectoDe, tipoDeValor } from "./efectos";

const PRECIO = /^\d{1,4}(\.\d{1,3})?$/;   // numeric(7,3), mayor que cero
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const TIPOS = { normal: "Normal", sancion: "Sanción" } as const;

/** El precio que rige hoy de cada tipo: el de vigencia más reciente que ya empezó (fn_precio_leche). */
export function preciosVigentes(historial: Precio[], hoy: string): Set<number> {
  const vigentes = new Set<number>();
  for (const tipo of ["normal", "sancion"] as const) {
    const actual = historial.filter((p) => p.tipo === tipo && p.vigente_desde <= hoy)
      .sort((a, b) => b.vigente_desde.localeCompare(a.vigente_desde))[0];
    if (actual) vigentes.add(actual.id);
  }
  return vigentes;
}

function textoValor(valor: string): string {
  if (valor === "true") return "Sí";
  if (valor === "false") return "No";
  return valor;
}

/** Cambiar un parámetro: el control sigue el formato del valor actual, que el servidor exige conservar. */
function VentanaParametro({ parametro, onHecho, onCerrar }: { parametro: Parametro; onHecho: (p: Parametro) => void; onCerrar: () => void }) {
  const id = useId();
  const tipo = tipoDeValor(parametro.valor);
  const [valor, setValor] = useState(parametro.valor);
  const [error, setError] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState(false);
  const efecto = efectoDe(parametro.clave);

  async function guardar() {
    setError(null);
    const limpio = valor.trim();
    if (limpio === "") {
      setError("Escriba un valor");
      return;
    }
    setOcupada(true);
    try {
      onHecho(await editarParametro(parametro.clave, limpio));
    } catch (e) {
      if (e instanceof ErrorSesion) return;
      setError(mensajeDeError(e));
      setOcupada(false);
    }
  }

  return (
    <Modal
      titulo="Cambiar parámetro"
      onCerrar={onCerrar}
      ocupada={ocupada}
      acciones={
        <>
          <button type="button" className="boton boton-secundario" onClick={onCerrar} disabled={ocupada}>Cancelar</button>
          <button type="button" className="boton boton-primario" onClick={guardar} disabled={ocupada || valor.trim() === parametro.valor}>
            {ocupada ? "Guardando…" : "Guardar"}
          </button>
        </>
      }
    >
      <p>{parametro.descripcion ?? parametro.clave}</p>
      <ul className="lista-avisos">
        {efecto && <li>{efecto}</li>}
        <li>El cambio queda en el historial de cambios, con su autor.</li>
      </ul>
      <Campo id={`${id}-valor`} etiqueta={`Valor (${parametro.clave})`} deshabilitado={ocupada}>
        {(p) => tipo === "booleano" ? (
          <select {...p} value={valor} onChange={(e) => setValor(e.target.value)}>
            <option value="true">Sí</option>
            <option value="false">No</option>
          </select>
        ) : tipo === "color" ? (
          <input {...p} type="color" className="campo-color" value={valor} onChange={(e) => setValor(e.target.value.toUpperCase())} />
        ) : (
          <input {...p} type="text" inputMode={tipo === "numero" ? "decimal" : undefined} value={valor}
                 onChange={(e) => setValor(e.target.value)} />
        )}
      </Campo>
      {error !== null && <p className="aviso aviso-error" role="alert">{error}</p>}
    </Modal>
  );
}

/** A13 · Precio de la leche (con historial) y parámetros de negocio. */
export default function Configuracion() {
  useTitulo("Configuración");
  const id = useId();
  const [hoy] = useState(() => hoyLima());
  const precios = useCarga(historialPrecios, []);
  const parametros = useCarga(listarParametros, []);
  const [tipo, setTipo] = useState<"normal" | "sancion">("normal");
  const [precio, setPrecio] = useState("");
  const [desde, setDesde] = useState(hoy);
  const [errores, setErrores] = useState<{ precio?: string; desde?: string }>({});
  const [confirmarPrecio, setConfirmarPrecio] = useState(false);
  const [aEditar, setAEditar] = useState<Parametro | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  function revisarPrecio() {
    const e: typeof errores = {};
    if (!PRECIO.test(precio.trim()) || Number(precio.trim()) <= 0) e.precio = "Soles por litro, mayor que cero y con hasta 3 decimales";
    if (!FECHA.test(desde)) e.desde = "Elija la fecha";
    setErrores(e);
    setAviso(null);
    if (Object.keys(e).length === 0) setConfirmarPrecio(true);
  }

  const vigentes = precios.carga.estado === "listo" ? preciosVigentes(precios.carga.datos, hoy) : new Set<number>();

  return (
    <>
      <div className="encabezado">
        <h1>Configuración</h1>
      </div>
      {aviso !== null && <p className="aviso aviso-ok" role="status">{aviso}</p>}

      <section className="seccion" aria-labelledby={`${id}-precios`}>
        <h2 id={`${id}-precios`}>Precio de la leche al productor</h2>
        <div className="filtros">
          <Campo id={`${id}-tipo`} etiqueta="Tipo">
            {(p) => (
              <select {...p} value={tipo} onChange={(e) => setTipo(e.target.value as "normal" | "sancion")}>
                <option value="normal">Normal</option>
                <option value="sancion">Sanción</option>
              </select>
            )}
          </Campo>
          <Campo id={`${id}-precio`} etiqueta="Precio por litro (S/)" error={errores.precio}>
            {(p) => <input {...p} type="text" inputMode="decimal" value={precio} onChange={(e) => setPrecio(e.target.value)} />}
          </Campo>
          <Campo id={`${id}-desde`} etiqueta="Vigente desde" error={errores.desde}>
            {(p) => <input {...p} type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />}
          </Campo>
          <button type="button" className="boton boton-primario" onClick={revisarPrecio}>Registrar precio</button>
        </div>

        {precios.carga.estado === "cargando" && <p>Cargando precios…</p>}
        {precios.carga.estado === "error" && (
          <p className="aviso aviso-error" role="alert">
            {precios.carga.mensaje}{" "}
            <button type="button" className="boton-enlace" onClick={precios.recargar}>Reintentar</button>
          </p>
        )}
        {precios.carga.estado === "listo" && (
          <table className="tabla" aria-label="Historial de precios">
            <thead>
              <tr>
                <th>Tipo</th>
                <th className="numero">Precio por litro</th>
                <th>Vigente desde</th>
                <th>Registrado por</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {precios.carga.datos.map((p) => (
                <tr key={p.id}>
                  <td>{TIPOS[p.tipo]}</td>
                  <td className="numero">{soles(p.precio_litro, 3)}</td>
                  <td>{fecha(p.vigente_desde)}</td>
                  <td>{p.creado_por_nombre ?? "Carga inicial"} <span className="texto-suave">{fechaHoraLima(p.creado_en)}</span></td>
                  <td>
                    {vigentes.has(p.id) ? <Insignia tono="ok">Vigente</Insignia>
                      : p.vigente_desde > hoy ? <Insignia tono="atencion">Programado</Insignia>
                      : <span className="texto-suave">Anterior</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="seccion" aria-labelledby={`${id}-parametros`}>
        <h2 id={`${id}-parametros`}>Parámetros</h2>
        {parametros.carga.estado === "cargando" && <p>Cargando parámetros…</p>}
        {parametros.carga.estado === "error" && (
          <p className="aviso aviso-error" role="alert">
            {parametros.carga.mensaje}{" "}
            <button type="button" className="boton-enlace" onClick={parametros.recargar}>Reintentar</button>
          </p>
        )}
        {parametros.carga.estado === "listo" && (
          <table className="tabla" aria-label="Parámetros">
            <thead>
              <tr>
                <th>Parámetro</th>
                <th>Valor</th>
                <th>Cuándo se aplica</th>
                <th><span className="solo-lector">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {parametros.carga.datos.map((p) => (
                <tr key={p.clave}>
                  <td>{p.descripcion ?? p.clave}<br /><code className="texto-suave">{p.clave}</code></td>
                  <td>{textoValor(p.valor)}</td>
                  <td className="texto-suave">{efectoDe(p.clave) ?? ""}</td>
                  <td>
                    <button type="button" className="boton boton-secundario" onClick={() => setAEditar(p)}
                            aria-label={`Cambiar ${p.clave}`}>
                      Cambiar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {confirmarPrecio && (
        <Confirmar
          titulo="Registrar precio de la leche"
          textoConfirmar="Registrar precio"
          onCerrar={() => setConfirmarPrecio(false)}
          onConfirmar={async () => {
            await nuevoPrecio({ tipo, precio_litro: Number(precio.trim()), vigente_desde: desde });
            setConfirmarPrecio(false);
            setPrecio("");
            setAviso(`Precio ${TIPOS[tipo].toLowerCase()} de ${soles(Number(precio.trim()), 3)} registrado desde el ${fecha(desde)}.`);
            precios.recargar();
          }}
        >
          {/* fn_precio_leche: rige el de vigencia más reciente; v_recoleccion_pago lo usa en vivo salvo lo liquidado */}
          <ul className="lista-avisos">
            <li>Desde el {fecha(desde)}, la leche {tipo === "normal" ? "normal" : "con sanción"} se paga a {soles(Number(precio.trim()), 3)} por litro.</li>
            <li>
              Cambia también el monto de las entregas desde esa fecha que todavía no estén liquidadas; las liquidadas
              mantienen su monto.
              {desde < hoy && " La fecha es anterior a hoy: afecta entregas ya registradas."}
            </li>
            <li>Los celulares ven el precio del día en su próxima sincronización.</li>
            <li>El historial no se edita ni se borra.</li>
          </ul>
        </Confirmar>
      )}

      {aEditar !== null && (
        <VentanaParametro
          parametro={aEditar}
          onCerrar={() => setAEditar(null)}
          onHecho={(nuevo) => {
            setAEditar(null);
            setAviso(`Parámetro ${nuevo.clave} actualizado: ${textoValor(nuevo.valor)}.`);
            parametros.recargar();
          }}
        />
      )}
    </>
  );
}
