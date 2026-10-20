import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import type { InsumoStock, Receta } from "../../api/tipos";
import { respuestaLogin } from "../../pruebas/datos";
import { renderizar, ubicacion } from "../../pruebas/renderizar";
import { API, servidor } from "../../pruebas/servidor";
import { guardarSesion } from "../../sesion/almacen";
import { alcanceInsumo, alcanceReceta } from "./alcance";

beforeEach(() => {
  guardarSesion(respuestaLogin());
});

const INSUMOS: InsumoStock[] = [
  { insumo_id: 1, nombre: "Cuajo líquido", unidad: "ml", stock: 150, estado: "disponible", costo_unitario: 0.08,
    ultima_actualizacion: "2026-10-03T09:00:00-05:00" },
  { insumo_id: 3, nombre: "Sal", unidad: "kg", stock: 50, estado: "disponible", costo_unitario: 1.5, ultima_actualizacion: null },
  { insumo_id: 6, nombre: "Azúcar", unidad: "kg", stock: 0, estado: "sin_stock", costo_unitario: 3.8, ultima_actualizacion: null },
  { insumo_id: 9, nombre: "Etiquetas", unidad: "unidad", stock: 500, estado: "disponible", costo_unitario: 0.02,
    ultima_actualizacion: null },
];

// Queso paria: cuajo 20 ml y sal 1.5 kg por 100 L. Yogurt (base 50 L): azúcar 4 kg y cuajo 5 ml por 50 L.
const RECETAS: Receta[] = [
  { id: 1, nombre: "Queso paria", unidad_venta: "unidad", precio_venta: 20, litros_base: 100, rendimiento_base: 11,
    dias_vida_util: 30, activa: true,
    insumos: [{ insumo_id: 1, nombre: "Cuajo líquido", unidad: "ml", cantidad: 20 },
              { insumo_id: 3, nombre: "Sal", unidad: "kg", cantidad: 1.5 }] },
  { id: 4, nombre: "Yogurt", unidad_venta: "kilo", precio_venta: 7, litros_base: 50, rendimiento_base: 52.5,
    dias_vida_util: null, activa: true,
    insumos: [{ insumo_id: 6, nombre: "Azúcar", unidad: "kg", cantidad: 4 },
              { insumo_id: 1, nombre: "Cuajo líquido", unidad: "ml", cantidad: 5 }] },
  { id: 9, nombre: "Receta vieja", unidad_venta: "unidad", precio_venta: null, litros_base: 100, rendimiento_base: null,
    dias_vida_util: null, activa: false, insumos: [] },
];

function simular() {
  servidor.use(
    http.get(`${API}/insumos`, () => HttpResponse.json(INSUMOS)),
    http.get(`${API}/recetas`, () => HttpResponse.json(RECETAS)),
  );
}

function celdas(tabla: HTMLElement, texto: string): string[] {
  return within(within(tabla).getByText(texto).closest("tr")!).getAllByRole("cell").map((c) => c.textContent ?? "");
}

describe("alcance", () => {
  const stock = new Map(INSUMOS.map((i) => [i.insumo_id, i.stock]));

  it("receta: lo que permite el insumo más escaso, redondeado hacia abajo", () => {
    expect(alcanceReceta(RECETAS[0]!, stock)).toBe(750);          // cuajo 150 ÷ 20 × 100 = 750; sal 50 ÷ 1.5 × 100 = 3333
    expect(alcanceReceta(RECETAS[1]!, stock)).toBe(0);            // sin azúcar
    expect(alcanceReceta(RECETAS[2]!, stock)).toBeNull();         // sin insumos registrados
    expect(alcanceReceta({ ...RECETAS[0]!, insumos: [{ insumo_id: 3, nombre: "Sal", unidad: "kg", cantidad: 1.5 }] },
                         new Map([[3, 1]]))).toBe(66);            // 66.67 → 66
  });

  it("insumo: la receta que más lo usa por litro manda; si ninguna lo usa, null", () => {
    // Cuajo: paria 20 ml / 100 L (750 L) y yogurt 5 ml / 50 L (1500 L) → paria
    expect(alcanceInsumo(1, 150, RECETAS)).toEqual({ litros: 750, receta: "Queso paria" });
    expect(alcanceInsumo(1, 150, [RECETAS[1]!, RECETAS[0]!])).toEqual({ litros: 750, receta: "Queso paria" });   // en otro orden
    expect(alcanceInsumo(9, 500, RECETAS)).toBeNull();
    expect(alcanceInsumo(6, -2, RECETAS)).toEqual({ litros: 0, receta: "Yogurt" });   // stock negativo cuenta como 0
  });
});

describe("almacén", () => {
  it("el menú (Planta) lleva al Almacén: stock, costo, valor, alcanza para y sin stock", async () => {
    simular();
    renderizar("/");
    await userEvent.setup().click(within(screen.getByRole("list", { name: "Planta" })).getByRole("link", { name: "Almacén" }));

    expect(ubicacion()).toBe("/almacen");
    const tabla = await screen.findByRole("table", { name: "Insumos" });
    await waitFor(() => expect(celdas(tabla, "Cuajo líquido")[4]).toBe("≈ 750 L (Queso paria)"));
    expect(celdas(tabla, "Cuajo líquido").slice(1, 4)).toEqual(["150 ml", "S/ 0.0800 / ml", "S/ 12.00"]);
    expect(celdas(tabla, "Cuajo líquido")[5]).toBe("03/10/2026 09:00");
    expect(celdas(tabla, "Azúcar")[0]).toBe("Azúcar Sin stock");
    expect(celdas(tabla, "Azúcar")[4]).toBe("≈ 0 L (Yogurt)");
    expect(celdas(tabla, "Etiquetas")[4]).toBe("Ninguna receta lo usa");
    expect(celdas(tabla, "Sal")[5]).toBe("—");
    expect(screen.getByText(/Valor del inventario/).closest("p")).toHaveTextContent("Valor del inventario: S/ 97.00 · 1 insumo sin stock");
    await waitFor(() => expect(document.title).toBe("Almacén · Quesería Huata"));
  });

  it("si las recetas no cargan, la tabla se muestra igual sin 'alcanza para'", async () => {
    simular();
    servidor.use(http.get(`${API}/recetas`, () => HttpResponse.json({ codigo: "error_interno", mensaje: "Error" }, { status: 500 })));
    renderizar("/almacen");
    const tabla = await screen.findByRole("table", { name: "Insumos" });
    expect(celdas(tabla, "Sal")[1]).toBe("50 kg");
    expect(celdas(tabla, "Sal")[4]).toBe("");
  });
});

describe("recetas", () => {
  it("el menú lleva a Recetas: unidad, precio, rendimiento y vida útil, insumos por 100 L con su costo y alcance", async () => {
    simular();
    renderizar("/");
    await userEvent.setup().click(within(screen.getByRole("list", { name: "Planta" })).getByRole("link", { name: "Recetas" }));

    expect(ubicacion()).toBe("/recetas");
    const paria = (await screen.findByRole("heading", { name: "Queso paria" })).closest("section")!;
    expect(paria).toHaveTextContent("Se vende por unidad a S/ 20.00 · rinde 11 unidades por 100 L · vida útil 30 días");
    await waitFor(() => expect(paria).toHaveTextContent("Insumos por 100 L: S/ 3.85"));    // 20 × 0.08 + 1.5 × 1.5
    expect(paria).toHaveTextContent("Con el stock actual alcanza para ≈ 750 L de leche");
    expect(celdas(within(paria).getByRole("table"), "Sal")).toEqual(["Sal", "1.5 kg", "S/ 2.25"]);

    // Yogurt escrito para 50 L: se muestra por 100 L
    const yogurt = screen.getByRole("heading", { name: "Yogurt" }).closest("section")!;
    expect(yogurt).toHaveTextContent("Se vende por kilo a S/ 7.00 · rinde 105 kilos por 100 L · vida útil sin control");
    expect(celdas(within(yogurt).getByRole("table"), "Azúcar")).toEqual(["Azúcar", "8 kg", "S/ 30.40"]);
    expect(yogurt).toHaveTextContent("alcanza para ≈ 0 L de leche");

    const vieja = screen.getByRole("heading", { name: /Receta vieja/ }).closest("section")!;
    expect(vieja).toHaveTextContent("Inactiva");
    expect(vieja).toHaveTextContent("rinde — (sin dato) por 100 L");
    expect(vieja).toHaveTextContent("Sin insumos registrados");
  });

  it("si el almacén no carga, las recetas se muestran sin costo ni alcance", async () => {
    simular();
    servidor.use(http.get(`${API}/insumos`, () => HttpResponse.json({ codigo: "error_interno", mensaje: "Error" }, { status: 500 })));
    renderizar("/recetas");
    const paria = (await screen.findByRole("heading", { name: "Queso paria" })).closest("section")!;
    await waitFor(() => expect(celdas(within(paria).getByRole("table"), "Sal")[2]).toBe("—"));
    expect(paria).not.toHaveTextContent("alcanza para");
  });
});
