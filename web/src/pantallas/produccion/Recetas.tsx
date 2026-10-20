import { useId } from "react";

import { listarInsumos, listarRecetas } from "../../api/produccion";
import { litros, soles } from "../../comun/formato";
import { Insignia } from "../../comun/Insignia";
import { useCarga } from "../../comun/useCarga";
import { useTitulo } from "../../comun/useTitulo";
import { alcanceReceta } from "./alcance";
import { unidadDe } from "./Produccion";

/** A8 (solo lectura) · Recetas con su rendimiento, vida útil, insumos por 100 L, costo de insumos y para cuánta leche alcanza. */
export default function Recetas() {
  useTitulo("Recetas");
  const id = useId();
  const recetas = useCarga(listarRecetas, []);
  // Para el costo de insumos y "alcanza para": si no cargan, las recetas se muestran igual
  const insumos = useCarga(listarInsumos, []);
  const stock = new Map(insumos.carga.estado === "listo" ? insumos.carga.datos.map((i) => [i.insumo_id, i.stock]) : []);
  const costo = new Map(insumos.carga.estado === "listo" ? insumos.carga.datos.map((i) => [i.insumo_id, i.costo_unitario]) : []);

  return (
    <>
      <div className="encabezado">
        <h1>Recetas</h1>
      </div>
      <p className="texto-suave">
        Solo lectura. Cantidades por 100 L de leche; los quesos rinden unidades y el yogurt kilos. El costo de insumos usa
        el costo promedio de hoy del almacén (sin la leche). Editar recetas es de la Fase 2.
      </p>

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
            <h2 id={`${id}-${n}`}>{r.nombre}{!r.activa && <> <Insignia tono="neutro">Inactiva</Insignia></>}</h2>
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
    </>
  );
}
