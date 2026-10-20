import { useId, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { categoriasGasto, listarGastos, registrarGasto } from "../../api/gastos";
import { listarAcopiadores } from "../../api/usuarios";
import { Campo } from "../../comun/Campo";
import { Confirmar } from "../../comun/Confirmar";
import { fecha, hoyLima, primerDiaDelMes, soles, sumarDias } from "../../comun/formato";
import { Insignia } from "../../comun/Insignia";
import { useCarga } from "../../comun/useCarga";
import { useTitulo } from "../../comun/useTitulo";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MONTO = /^\d{1,10}(\.\d{1,2})?$/;   // numeric(12,2)
const MAX_DIAS = 400;                       // el máximo que acepta GET /gastos

type Valores = { fecha: string; categoria_id: string; monto: string; acopiador_id: string; descripcion: string };

/** A12 · Gastos operativos del periodo y registrar uno nuevo (no se editan ni se eliminan). */
export default function Gastos() {
  useTitulo("Gastos");
  const id = useId();
  const [hoy] = useState(() => hoyLima());
  const [parametros, setParametros] = useSearchParams();
  const desde = parametros.get("desde") ?? primerDiaDelMes(hoy);
  const hasta = parametros.get("hasta") ?? hoy;
  const valido = FECHA.test(desde) && FECHA.test(hasta) && hasta >= desde && hasta <= sumarDias(desde, MAX_DIAS - 1);
  const gastos = useCarga(() => (valido ? listarGastos(desde, hasta) : Promise.resolve([])), [desde, hasta]);
  const categorias = useCarga(categoriasGasto, []);
  const acopiadores = useCarga(listarAcopiadores, []);
  const [rango, setRango] = useState({ desde, hasta });
  const [errRango, setErrRango] = useState<string | undefined>();
  const [v, setV] = useState<Valores>({ fecha: hoy, categoria_id: "", monto: "", acopiador_id: "", descripcion: "" });
  const [errores, setErrores] = useState<Partial<Record<keyof Valores, string>>>({});
  const [confirmar, setConfirmar] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  // El formulario ofrece solo las categorías manuales: "Sueldo acopiador" la crea el pago mensual (y el backend la rechaza)
  const manuales = categorias.carga.estado === "listo" ? categorias.carga.datos.filter((c) => c.manual) : [];
  const activos = acopiadores.carga.estado === "listo" ? acopiadores.carga.datos.filter((a) => a.activo) : [];
  const categoria = manuales.find((c) => String(c.id) === v.categoria_id);
  const acopiador = activos.find((a) => String(a.id) === v.acopiador_id);

  function aplicarRango() {
    let e: string | undefined;
    if (!FECHA.test(rango.desde) || !FECHA.test(rango.hasta)) e = "Elija las dos fechas";
    else if (rango.hasta < rango.desde) e = "No puede ser anterior a la fecha inicial";
    else if (rango.hasta > sumarDias(rango.desde, MAX_DIAS - 1)) e = `Elija como máximo ${MAX_DIAS} días`;
    setErrRango(e);
    if (!e) setParametros({ desde: rango.desde, hasta: rango.hasta });
  }

  function revisar() {
    const e: typeof errores = {};
    if (!FECHA.test(v.fecha)) e.fecha = "Elija la fecha";
    if (!categoria) e.categoria_id = "Elija la categoría";
    if (!MONTO.test(v.monto.trim()) || Number(v.monto.trim()) <= 0) e.monto = "Monto en soles, mayor que cero y con hasta 2 decimales";
    setErrores(e);
    setAviso(null);
    if (Object.keys(e).length === 0) setConfirmar(true);
  }

  const filas = gastos.carga.estado === "listo" ? gastos.carga.datos : [];
  const total = Math.round(filas.reduce((s, g) => s + g.monto, 0) * 100) / 100;
  const porCategoria = [...filas.reduce((m, g) => m.set(g.categoria, (m.get(g.categoria) ?? 0) + g.monto), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1]);

  return (
    <>
      <div className="encabezado">
        <h1>Gastos</h1>
      </div>
      <p className="texto-suave">
        Gastos generales (combustible, servicios, alquiler…). Los de un lote van en el lote. Los sueldos de los
        acopiadores se registran solos al marcar pagado su pago mensual.
      </p>
      {aviso !== null && <p className="aviso aviso-ok" role="status">{aviso}</p>}

      <section className="seccion" aria-labelledby={`${id}-nuevo`}>
        <h2 id={`${id}-nuevo`}>Registrar gasto</h2>
        <div className="formulario-rejilla">
          <Campo id={`${id}-fecha`} etiqueta="Fecha" error={errores.fecha}>
            {(p) => <input {...p} type="date" value={v.fecha} onChange={(e) => setV((x) => ({ ...x, fecha: e.target.value }))} />}
          </Campo>
          <Campo id={`${id}-categoria`} etiqueta="Categoría" error={errores.categoria_id}>
            {(p) => (
              <select {...p} value={v.categoria_id} onChange={(e) => setV((x) => ({ ...x, categoria_id: e.target.value }))}>
                <option value="">Elija…</option>
                {manuales.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            )}
          </Campo>
          <Campo id={`${id}-monto`} etiqueta="Monto (S/)" error={errores.monto}>
            {(p) => <input {...p} type="text" inputMode="decimal" value={v.monto} onChange={(e) => setV((x) => ({ ...x, monto: e.target.value }))} />}
          </Campo>
          <Campo id={`${id}-acopiador`} etiqueta="Acopiador (opcional)" ayuda="Para saber cuánto cuesta cada ruta.">
            {(p) => (
              <select {...p} value={v.acopiador_id} onChange={(e) => setV((x) => ({ ...x, acopiador_id: e.target.value }))}>
                <option value="">Ninguno</option>
                {activos.map((a) => <option key={a.id} value={a.id}>{a.nombre_completo}</option>)}
              </select>
            )}
          </Campo>
          <Campo id={`${id}-descripcion`} etiqueta="Descripción (opcional)">
            {(p) => <input {...p} type="text" value={v.descripcion} onChange={(e) => setV((x) => ({ ...x, descripcion: e.target.value }))} />}
          </Campo>
        </div>
        <div className="fila-acciones">
          <button type="button" className="boton boton-primario" onClick={revisar}>Registrar gasto</button>
        </div>
      </section>

      <section className="seccion" aria-labelledby={`${id}-lista`}>
        <h2 id={`${id}-lista`}>Gastos del {fecha(desde)} al {fecha(hasta)}</h2>
        <div className="filtros">
          <Campo id={`${id}-desde`} etiqueta="Desde">
            {(p) => <input {...p} type="date" value={rango.desde} onChange={(e) => setRango((r) => ({ ...r, desde: e.target.value }))} />}
          </Campo>
          <Campo id={`${id}-hasta`} etiqueta="Hasta" error={errRango}>
            {(p) => <input {...p} type="date" value={rango.hasta} onChange={(e) => setRango((r) => ({ ...r, hasta: e.target.value }))} />}
          </Campo>
          <button type="button" className="boton boton-secundario" onClick={aplicarRango}>Ver</button>
        </div>
        {!valido && <p className="aviso aviso-atencion">El rango de la dirección no es válido: elija las fechas y pulse Ver.</p>}
        {gastos.carga.estado === "cargando" && <p>Cargando gastos…</p>}
        {gastos.carga.estado === "error" && (
          <p className="aviso aviso-error" role="alert">
            {gastos.carga.mensaje}{" "}
            <button type="button" className="boton-enlace" onClick={gastos.recargar}>Reintentar</button>
          </p>
        )}
        {gastos.carga.estado === "listo" && valido && (filas.length === 0 ? (
          <p className="texto-suave">No hay gastos en ese periodo.</p>
        ) : (
          <>
            <p>
              <strong>Total: {soles(total)}</strong>
              <span className="texto-suave"> ({porCategoria.map(([c, m]) => `${c}: ${soles(m)}`).join(" · ")})</span>
            </p>
            <table className="tabla" aria-label="Gastos">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Categoría</th>
                  <th>Descripción</th>
                  <th>Acopiador</th>
                  <th className="numero">Monto</th>
                  <th>Registró</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((g) => (
                  <tr key={g.id}>
                    <td>{fecha(g.fecha)}</td>
                    <td>{g.categoria}{g.del_pago_mensual && <> <Insignia tono="neutro">Pago mensual</Insignia></>}</td>
                    <td>{g.descripcion ?? ""}</td>
                    <td>{g.acopiador ?? ""}</td>
                    <td className="numero">{soles(g.monto)}</td>
                    <td>{g.registrado_por_nombre}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ))}
      </section>

      {confirmar && categoria && (
        <Confirmar
          titulo="Registrar gasto"
          textoConfirmar="Registrar gasto"
          onCerrar={() => setConfirmar(false)}
          onConfirmar={async () => {
            await registrarGasto({
              fecha: v.fecha, categoria_id: categoria.id, monto: Number(v.monto.trim()),
              acopiador_id: acopiador?.id ?? null, descripcion: v.descripcion.trim() === "" ? null : v.descripcion.trim(),
            });
            setConfirmar(false);
            setAviso(`Gasto de ${soles(Number(v.monto.trim()))} en ${categoria.nombre} registrado.`);
            setV({ fecha: hoy, categoria_id: "", monto: "", acopiador_id: "", descripcion: "" });
            gastos.recargar();
          }}
        >
          <ul className="lista-avisos">
            <li>{categoria.nombre}: {soles(Number(v.monto.trim()))} el {fecha(v.fecha)}{acopiador ? `, de ${acopiador.nombre_completo}` : ""}.</li>
            <li>Cuenta en el flujo de caja y en el resultado de su mes.</li>
            <li>No se puede editar ni eliminar desde el panel.</li>
          </ul>
        </Confirmar>
      )}
    </>
  );
}
