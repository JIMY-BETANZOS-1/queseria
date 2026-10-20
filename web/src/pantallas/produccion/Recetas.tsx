import { useId, useState } from "react";

import { listarInsumos, listarRecetas } from "../../api/produccion";
import type { Receta } from "../../api/tipos";
import { litros, soles } from "../../comun/formato";
import { Insignia } from "../../comun/Insignia";
import { useCarga } from "../../comun/useCarga";
import { useTitulo } from "../../comun/useTitulo";
import { alcanceReceta } from "./alcance";
import { unidadDe } from "./Produccion";
import { VentanaReceta } from "./VentanaReceta";

/** A8 · Recetas con su rendimiento, vida útil, insumos por 100 L, costo de insumos y para cuánta leche alcanza; crear,
 * editar y duplicar (solo afecta a la producción futura). */
export default function Recetas() {
  useTitulo("Recetas");
  const id = useId();
  const recetas = useCarga(listarRecetas, []);
  // Para el costo de insumos y "alcanza para": si no cargan, las recetas se muestran igual
  const insumos = useCarga(listarInsumos, []);
  const stock = new Map(insumos.carga.estado === "listo" ? insumos.carga.datos.map((i) => [i.insumo_id, i.stock]) : []);
  const costo = new Map(insumos.carga.estado === "listo" ? insumos.carga.datos.map((i) => [i.insumo_id, i.costo_unitario]) : []);
  const [ventana, setVentana] = useState<{ modo: "crear" | "editar"; receta?: Receta } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const abrir = (v: { modo: "crear" | "editar"; receta?: Receta }) => { setAviso(null); setVentana(v); };

  return (
    <>
      <div className="encabezado">
        <h1>Recetas</h1>
        <button type="button" className="boton boton-primario" onClick={() => abrir({ modo: "crear" })}>Nueva receta</button>
      </div>
      <p className="texto-suave">
        Cantidades por 100 L de leche; los quesos rinden unidades y el yogurt kilos. El costo de insumos usa el costo
        promedio de hoy del almacén (sin la leche). Los cambios solo afectan a la producción que viene.
      </p>
      {aviso !== null && <p className="aviso aviso-ok" role="status">{aviso}</p>}

      {recetas.carga.estado === "cargando" && <p>Cargando recetas…</p>}
      {recetas.carga.estado === "error" && (
        <p className="aviso aviso-error" role="alert">
          {recetas.carga.mensaje}{" "}
          <button type="button" className="boton-enlace" onClick={recetas.recargar}>Reintentar</button>
        </p>
      )}
      {recetas.carga.estado === "listo" && recetas.carga.datos.map((r, n) => {
        // Por 100 L, aunque la receta esté escrita para otra base
        const por100 = (cantidad: number) => Math.round((cantidad / r.litros_base) * 100 * 1000) / 1000;
        const costoInsumos = insumos.carga.estado === "listo"
          ? Math.round(r.insumos.reduce((s, i) => s + por100(i.cantidad) * (costo.get(i.insumo_id) ?? 0), 0) * 100) / 100 : null;
        const alcance = insumos.carga.estado === "listo" ? alcanceReceta(r, stock) : undefined;
        const rinde = r.rendimiento_base == null ? null : Math.round((r.rendimiento_base / r.litros_base) * 100 * 100) / 100;
        return (
          <section key={r.id} className="seccion" aria-labelledby={`${id}-${n}`}>
            <div className="encabezado-seccion">
              <h2 id={`${id}-${n}`}>{r.nombre}{!r.activa && <> <Insignia tono="neutro">Inactiva</Insignia></>}</h2>
              <div className="acciones-receta">
                <button type="button" className="boton boton-secundario" aria-label={`Editar ${r.nombre}`}
                        onClick={() => abrir({ modo: "editar", receta: r })}>
                  Editar
                </button>
                <button type="button" className="boton boton-secundario" aria-label={`Duplicar ${r.nombre} como nueva`}
                        onClick={() => abrir({ modo: "crear", receta: r })}>
                  Duplicar como nueva
                </button>
              </div>
            </div>
            <p>
              Se vende por {r.unidad_venta === "kilo" ? "kilo" : "unidad"}
              {r.precio_venta != null && <> a {soles(r.precio_venta)}</>}
              {" · "}rinde {rinde == null ? "— (sin dato)" : `${rinde} ${unidadDe(r)}`} por 100 L
              {" · "}vida útil {r.dias_vida_util == null ? "sin control" : `${r.dias_vida_util} días`}
            </p>
            <p>
              {costoInsumos !== null && <>Insumos por 100 L: <strong>{soles(costoInsumos)}</strong></>}
              {alcance !== undefined && <>
                {costoInsumos !== null && " · "}
                {alcance === null ? "Sin insumos registrados" : <>Con el stock actual alcanza para <strong>≈ {litros(alcance)}</strong> de leche</>}
              </>}
            </p>
            {r.insumos.length > 0 && (
              <table className="tabla" aria-label={`Insumos de ${r.nombre}`}>
                <thead>
                  <tr>
                    <th>Insumo</th>
                    <th className="numero">Por 100 L</th>
                    <th className="numero">Costo por 100 L</th>
                  </tr>
                </thead>
                <tbody>
                  {r.insumos.map((i) => (
                    <tr key={i.insumo_id}>
                      <td>{i.nombre}</td>
                      <td className="numero">{por100(i.cantidad)} {i.unidad}</td>
                      <td className="numero">{costo.has(i.insumo_id) ? soles(por100(i.cantidad) * (costo.get(i.insumo_id) ?? 0)) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}

      {ventana !== null && (
        <VentanaReceta modo={ventana.modo} receta={ventana.receta}
                       insumos={insumos.carga.estado === "listo" ? insumos.carga.datos : []}
                       onCerrar={() => setVentana(null)}
                       onHecho={(r) => {
                         setVentana(null);
                         setAviso(ventana.modo === "editar" ? `Receta ${r.nombre} guardada.` : `Receta ${r.nombre} creada.`);
                         recetas.recargar();
                       }} />
      )}
    </>
  );
}
