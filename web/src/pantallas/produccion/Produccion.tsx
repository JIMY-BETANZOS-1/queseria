import { useEffect, useId, useState } from "react";

import { jornadas } from "../../api/dashboard";
import { ErrorSesion } from "../../api/cliente";
import { listarLotes, listarRecetas, previaProduccion, producir } from "../../api/produccion";
import type { PreviaProduccion, Receta } from "../../api/tipos";
import { Campo } from "../../comun/Campo";
import { Confirmar } from "../../comun/Confirmar";
import { fecha, hoyLima, litros, soles, sumarDias } from "../../comun/formato";
import { mensajeDeError, useCarga } from "../../comun/useCarga";
import { useTitulo } from "../../comun/useTitulo";

const CANTIDAD = /^\d{1,8}(\.\d{1,2})?$/;
export const DIAS_LECHE = 30;   // jornadas recientes con leche aprobada disponible

export const unidadDe = (r: Pick<Receta, "unidad_venta">) => (r.unidad_venta === "kilo" ? "kilos" : "unidades");
const DESVIO_AVISO = 0.2;   // más del 20 % lejos del teórico: aviso suave, no bloquea

/** Lo que la receta espera de esos litros: litros ÷ litros_base × rendimiento_base (2 decimales); null si no se sabe. */
export function teorico(r: Pick<Receta, "litros_base" | "rendimiento_base">, litrosLeche: number): number | null {
  if (r.rendimiento_base == null || !(litrosLeche > 0)) return null;
  return Math.round((litrosLeche / r.litros_base) * r.rendimiento_base * 100) / 100;
}

type Valores = { receta_id: string; fecha_leche: string; litros: string; cantidad: string };

/** A9 (rápida) · Un lote en un paso: leche de una jornada, insumos de la receta y cierre con lo producido. */
export default function Produccion() {
  useTitulo("Producción");
  const id = useId();
  const [hoy] = useState(() => hoyLima());
  const recetas = useCarga(listarRecetas, []);
  const conLeche = useCarga(() => jornadas(sumarDias(hoy, -(DIAS_LECHE - 1)), hoy), [hoy]);
  const lotes = useCarga(listarLotes, []);
  const [v, setV] = useState<Valores>({ receta_id: "", fecha_leche: "", litros: "", cantidad: "" });
  const [errores, setErrores] = useState<Partial<Record<keyof Valores, string>>>({});
  const [previa, setPrevia] = useState<PreviaProduccion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const activas = recetas.carga.estado === "listo" ? recetas.carga.datos.filter((r) => r.activa) : [];
  const receta = activas.find((r) => String(r.id) === v.receta_id);
  // De la más antigua a la más reciente: la leche es perecible y conviene usar primero la más vieja
  const jornadasConLeche = conLeche.carga.estado === "listo"
    ? conLeche.carga.datos.filter((j) => j.litros_disponibles > 0) : [];
  const totalDisponible = Math.round(jornadasConLeche.reduce((s, j) => s + j.litros_disponibles, 0) * 100) / 100;
  const masAntigua = jornadasConLeche[0]?.fecha ?? "";

  // Preselecciona la jornada más antigua con leche (se puede cambiar: cada una tiene su costo por litro útil)
  useEffect(() => {
    if (masAntigua !== "") setV((x) => (x.fecha_leche === "" ? { ...x, fecha_leche: masAntigua } : x));
  }, [masAntigua]);

  function cambiar(campo: keyof Valores, valor: string) {
    setV((x) => {
      const nuevo = { ...x, [campo]: valor };
      // Al cambiar los litros o la receta, la cantidad se propone con el rendimiento teórico (sigue siendo editable)
      if (campo === "litros" || campo === "receta_id") {
        const r = activas.find((y) => String(y.id) === nuevo.receta_id);
        const t = r ? teorico(r, Number(nuevo.litros)) : null;
        if (t !== null) nuevo.cantidad = String(t);
      }
      return nuevo;
    });
    setPrevia(null);   // lo que se vio ya no corresponde
    setAviso(null);
  }

  async function verPrevia() {
    const e: typeof errores = {};
    if (!receta) e.receta_id = "Elija la receta";
    if (v.fecha_leche === "") e.fecha_leche = "Elija la jornada de la leche";
    if (!CANTIDAD.test(v.litros.trim()) || Number(v.litros) <= 0) e.litros = "Litros mayores que cero, con hasta 2 decimales";
    if (!CANTIDAD.test(v.cantidad.trim())) e.cantidad = "Cantidad de 0 o más, con hasta 2 decimales";
    setErrores(e);
    setError(null);
    if (Object.keys(e).length > 0 || !receta) return;
    setCargando(true);
    try {
      setPrevia(await previaProduccion(receta.id, v.fecha_leche, Number(v.litros)));
    } catch (err) {
      if (err instanceof ErrorSesion) return;
      setError(mensajeDeError(err));
    } finally {
      setCargando(false);
    }
  }

  const litrosPedidos = Number(v.litros);
  const esperado = receta ? teorico(receta, litrosPedidos) : null;
  const muyDistinto = esperado !== null && esperado > 0 && CANTIDAD.test(v.cantidad.trim())
    && Math.abs(Number(v.cantidad) - esperado) / esperado > DESVIO_AVISO;
  const faltaLeche = previa !== null && previa.leche_disponible < litrosPedidos;
  const faltanInsumos = previa?.insumos.filter((i) => i.falta > 0) ?? [];
  const bloqueado = previa === null || faltaLeche || faltanInsumos.length > 0;

  return (
    <>
      <div className="encabezado">
        <h1>Producción</h1>
      </div>
      <p className="texto-suave">
        Un lote en un paso: toma leche aprobada de una jornada, descuenta los insumos de la receta y queda cerrado con lo
        producido. Un lote cerrado no se altera.
      </p>
      {aviso !== null && <p className="aviso aviso-ok" role="status">{aviso}</p>}

      <section className="seccion" aria-labelledby={`${id}-nuevo`}>
        <h2 id={`${id}-nuevo`}>Nuevo lote</h2>
        {conLeche.carga.estado === "listo" && (
          <p>Leche disponible (últimos {DIAS_LECHE} días): <strong>{litros(totalDisponible)}</strong></p>
        )}
        <div className="formulario-rejilla">
          <Campo id={`${id}-receta`} etiqueta="Receta" error={errores.receta_id}>
            {(p) => (
              <select {...p} value={v.receta_id} onChange={(e) => cambiar("receta_id", e.target.value)}>
                <option value="">Elija…</option>
                {activas.map((r) => <option key={r.id} value={r.id}>{r.nombre} ({unidadDe(r)})</option>)}
              </select>
            )}
          </Campo>
          <Campo id={`${id}-jornada`} etiqueta="Leche de la jornada" error={errores.fecha_leche}
                 ayuda={`Solo jornadas de los últimos ${DIAS_LECHE} días con leche aprobada disponible.`}>
            {(p) => (
              <select {...p} value={v.fecha_leche} onChange={(e) => cambiar("fecha_leche", e.target.value)}>
                <option value="">Elija…</option>
                {jornadasConLeche.map((j) => (
                  <option key={j.fecha} value={j.fecha}>{fecha(j.fecha)}: {litros(j.litros_disponibles)} disponibles</option>
                ))}
              </select>
            )}
          </Campo>
          <Campo id={`${id}-litros`} etiqueta="Litros de leche" error={errores.litros}>
            {(p) => <input {...p} type="text" inputMode="decimal" value={v.litros} onChange={(e) => cambiar("litros", e.target.value)} />}
          </Campo>
          <Campo id={`${id}-cantidad`} etiqueta={`Cantidad producida${receta ? ` (${unidadDe(receta)})` : ""}`} error={errores.cantidad}
                 ayuda={esperado !== null && receta ? `Se esperan ≈ ${esperado} ${unidadDe(receta)}.` : undefined}>
            {(p) => <input {...p} type="text" inputMode="decimal" value={v.cantidad} onChange={(e) => cambiar("cantidad", e.target.value)} />}
          </Campo>
        </div>
        {muyDistinto && (
          <p className="aviso aviso-atencion">
            La cantidad producida es muy distinta del rendimiento teórico de la receta (≈ {esperado}). Revísela antes de
            cerrar el lote; si es correcta, puede seguir.
          </p>
        )}
        <div className="fila-acciones">
          <button type="button" className="boton boton-secundario" onClick={verPrevia} disabled={cargando}>
            {cargando ? "Calculando…" : "Ver qué se necesita"}
          </button>
        </div>
        {error !== null && <p className="aviso aviso-error" role="alert">{error}</p>}

        {previa !== null && receta && (
          <>
            <p>
              Leche disponible el {fecha(v.fecha_leche)}: <strong>{litros(previa.leche_disponible)}</strong>
              {previa.costo_litro != null && <> · costo por litro útil {soles(previa.costo_litro, 4)}</>}
            </p>
            {faltaLeche && (
              <p className="aviso aviso-error" role="alert">
                No alcanza la leche aprobada de esa jornada: pidió {litros(litrosPedidos)}.
              </p>
            )}
            <table className="tabla" aria-label="Insumos del lote">
              <thead>
                <tr>
                  <th>Insumo</th>
                  <th className="numero">Necesita</th>
                  <th className="numero">Hay</th>
                  <th className="numero">Falta reponer</th>
                </tr>
              </thead>
              <tbody>
                {previa.insumos.map((i) => (
                  <tr key={i.insumo_id}>
                    <td>{i.nombre}</td>
                    <td className="numero">{i.necesita} {i.unidad}</td>
                    <td className="numero">{i.hay} {i.unidad}</td>
                    <td className={i.falta > 0 ? "numero negativo" : "numero"}>
                      {i.falta > 0 ? `${Math.round(i.falta * 1000) / 1000} ${i.unidad}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {faltanInsumos.length > 0 && (
              <p className="aviso aviso-error" role="alert">
                Falta stock de {faltanInsumos.map((i) => i.nombre).join(", ")}: repóngalo antes de producir.
              </p>
            )}
            <div className="fila-acciones">
              <button type="button" className="boton boton-primario" disabled={bloqueado} onClick={() => setConfirmar(true)}>
                Producir y cerrar lote
              </button>
            </div>
          </>
        )}
      </section>

      <section className="seccion" aria-labelledby={`${id}-lotes`}>
        <h2 id={`${id}-lotes`}>Lotes recientes</h2>
        {lotes.carga.estado === "error" && (
          <p className="aviso aviso-error" role="alert">
            {lotes.carga.mensaje}{" "}
            <button type="button" className="boton-enlace" onClick={lotes.recargar}>Reintentar</button>
          </p>
        )}
        {lotes.carga.estado === "listo" && (lotes.carga.datos.length === 0 ? <p className="texto-suave">Todavía no hay lotes.</p> : (
          <table className="tabla" aria-label="Lotes">
            <thead>
              <tr>
                <th>Lote</th>
                <th>Receta</th>
                <th>Producido el</th>
                <th className="numero">Leche</th>
                <th className="numero">Producido</th>
                <th className="numero">Vendido</th>
                <th className="numero">Saldo</th>
                <th className="numero">Costo total</th>
                <th className="numero">Costo por unidad</th>
                <th>Vence</th>
              </tr>
            </thead>
            <tbody>
              {lotes.carga.datos.map((l) => (
                <tr key={l.lote_id}>
                  <td className="codigo">{l.codigo}</td>
                  <td>{l.receta}</td>
                  <td>{fecha(l.fecha_produccion)}</td>
                  <td className="numero">{litros(l.litros_leche)}</td>
                  <td className="numero">{l.cantidad_producida ?? ""}</td>
                  <td className="numero">{l.cantidad_vendida}</td>
                  <td className="numero">{l.saldo ?? ""}</td>
                  <td className="numero">{soles(l.costo_total)}</td>
                  <td className="numero">{l.costo_por_unidad == null ? "—" : soles(l.costo_por_unidad)}</td>
                  <td>{l.fecha_vencimiento ? fecha(l.fecha_vencimiento) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </section>

      {confirmar && previa !== null && receta && (
        <Confirmar
          titulo="Producir y cerrar lote"
          textoConfirmar="Producir y cerrar lote"
          onCerrar={() => setConfirmar(false)}
          onConfirmar={async () => {
            const lote = await producir({
              receta_id: receta.id, fecha_leche: v.fecha_leche, litros: litrosPedidos, cantidad_producida: Number(v.cantidad),
            });
            setConfirmar(false);
            setPrevia(null);
            setV({ receta_id: "", fecha_leche: "", litros: "", cantidad: "" });
            setAviso(`Lote ${lote.codigo} de ${lote.receta} cerrado con ${lote.cantidad_producida} ${unidadDe(receta)}.`);
            lotes.recargar();
            conLeche.recargar();
          }}
        >
          <ul className="lista-avisos">
            <li>{receta.nombre}: {litros(litrosPedidos)} de la leche del {fecha(v.fecha_leche)}, al costo por litro útil de ese día.</li>
            <li>Se descuentan los insumos de la tabla y el lote queda cerrado con {v.cantidad} {unidadDe(receta)}; el código
              se asigna solo.</li>
            <li>Un lote cerrado no se altera.</li>
          </ul>
        </Confirmar>
      )}
    </>
  );
}
