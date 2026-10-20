// Gastos operativos (backend/app/routers/gastos.py): listar y registrar; no se editan ni se eliminan.
import { pedir } from "./cliente";
import type { CategoriaGasto, Gasto, GastoNuevo } from "./tipos";

/** `manual: false` = sus gastos solo los crea el pago mensual del acopiador. */
export const categoriasGasto = () => pedir<CategoriaGasto[]>("GET", "/categorias-gasto");
/** Del más reciente al más antiguo; incluye los creados por el pago mensual. */
export const listarGastos = (desde: string, hasta: string) => pedir<Gasto[]>("GET", "/gastos", { consulta: { desde, hasta } });
export const registrarGasto = (datos: GastoNuevo) => pedir<Gasto>("POST", "/gastos", { cuerpo: datos });
