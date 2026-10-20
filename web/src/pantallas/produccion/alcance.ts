// "Alcanza para ≈ N L de leche": cuánto se podría producir con el stock de hoy. Es solo lectura y se calcula aquí,
// porque la base no tiene stock mínimo por insumo (queda para la Fase 2). Se redondea hacia abajo: nunca promete más.
import type { Receta } from "../../api/tipos";

type RecetaAlcance = Pick<Receta, "id" | "nombre" | "litros_base" | "insumos">;

/** Litros de leche que cubre el stock de un insumo en una receta: stock ÷ cantidad × litros_base. */
function litrosPorInsumo(stock: number, cantidad: number, litrosBase: number): number {
  return Math.floor((Math.max(0, stock) / cantidad) * litrosBase);
}

/** Lo que permite el insumo más escaso de la receta; null si la receta no tiene insumos registrados. */
export function alcanceReceta(receta: RecetaAlcance, stock: Map<number, number>): number | null {
  if (receta.insumos.length === 0) return null;
  return Math.min(...receta.insumos.map((i) => litrosPorInsumo(stock.get(i.insumo_id) ?? 0, i.cantidad, receta.litros_base)));
}

/** Para un insumo: los litros que cubre en la receta que más lo usa por litro; null si ninguna receta lo usa. */
export function alcanceInsumo(insumoId: number, stock: number, recetas: RecetaAlcance[]): { litros: number; receta: string } | null {
  let peor: { litros: number; receta: string } | null = null;
  for (const r of recetas) {
    const uso = r.insumos.find((i) => i.insumo_id === insumoId);
    if (!uso) continue;
    const litros = litrosPorInsumo(stock, uso.cantidad, r.litros_base);
    if (peor === null || litros < peor.litros) peor = { litros, receta: r.nombre };
  }
  return peor;
}
