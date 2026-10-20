import { listarInsumos, listarRecetas } from "../../api/produccion";
import { fechaHoraLima, litros, soles } from "../../comun/formato";
import { Insignia } from "../../comun/Insignia";
import { useCarga } from "../../comun/useCarga";
import { useTitulo } from "../../comun/useTitulo";
import { alcanceInsumo } from "./alcance";

/** A7 (solo lectura) · Stock de insumos con costo promedio ponderado (v_insumo_stock) y para cuánta leche alcanza. */
export default function Almacen() {
  useTitulo("Almacén");
  const insumos = useCarga(listarInsumos, []);
  // Solo para "alcanza para": si las recetas no cargan, la tabla se muestra igual
  const recetas = useCarga(listarRecetas, []);
  const activas = recetas.carga.estado === "listo" ? recetas.carga.datos.filter((r) => r.activa) : [];

  const filas = insumos.carga.estado === "listo" ? insumos.carga.datos : [];
  const valorTotal = Math.round(filas.reduce((s, i) => s + Math.max(0, i.stock) * i.costo_unitario, 0) * 100) / 100;
  const sinStock = filas.filter((i) => i.estado === "sin_stock").length;

  return (
    <>
      <div className="encabezado">
        <h1>Almacén</h1>
      </div>
      <p className="texto-suave">
        Solo lectura. El stock es la suma de los movimientos (ingresos, consumos de lotes y ajustes) y el costo es el
        promedio ponderado que mantiene la base. "Alcanza para" dice cuánta leche cubre el stock en la receta que más usa
        ese insumo. Registrar ingresos y ajustes, y un stock mínimo por insumo, son de la Fase 2.
      </p>

      {insumos.carga.estado === "cargando" && <p>Cargando insumos…</p>}
      {insumos.carga.estado === "error" && (
        <p className="aviso aviso-error" role="alert">
          {insumos.carga.mensaje}{" "}
          <button type="button" className="boton-enlace" onClick={insumos.recargar}>Reintentar</button>
        </p>
      )}
      {insumos.carga.estado === "listo" && (filas.length === 0 ? <p className="texto-suave">No hay insumos registrados.</p> : (
        <>
          <p>
            <strong>Valor del inventario: {soles(valorTotal)}</strong>
            {sinStock > 0 && <> · <Insignia tono="error">{sinStock === 1 ? "1 insumo sin stock" : `${sinStock} insumos sin stock`}</Insignia></>}
          </p>
          <table className="tabla" aria-label="Insumos">
            <thead>
              <tr>
                <th>Insumo</th>
                <th className="numero">Stock</th>
                <th className="numero">Costo promedio</th>
                <th className="numero">Valor</th>
                <th>Alcanza para</th>
                <th>Último ingreso o ajuste</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((i) => {
                const alcance = recetas.carga.estado === "listo" ? alcanceInsumo(i.insumo_id, i.stock, activas) : undefined;
                return (
                  <tr key={i.insumo_id}>
                    <td>
                      {i.nombre}
                      {i.estado === "sin_stock" && <> <Insignia tono="error">Sin stock</Insignia></>}
                    </td>
                    <td className="numero">{i.stock} {i.unidad}</td>
                    <td className="numero">{soles(i.costo_unitario, 4)} / {i.unidad}</td>
                    <td className="numero">{soles(Math.max(0, i.stock) * i.costo_unitario)}</td>
                    <td>
                      {alcance === undefined ? "" : alcance === null
                        ? <span className="texto-suave">Ninguna receta lo usa</span>
                        : <>≈ {litros(alcance.litros)} <span className="texto-suave">({alcance.receta})</span></>}
                    </td>
                    <td>{i.ultima_actualizacion ? fechaHoraLima(i.ultima_actualizacion) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ))}
    </>
  );
}
