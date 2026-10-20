import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IngresoInsumo, InsumoNuevo, InsumoStock, Receta } from "../../api/tipos";
import { respuestaLogin } from "../../pruebas/datos";
import { irPorMenu } from "../../pruebas/menu";
import { renderizar, ubicacion } from "../../pruebas/renderizar";
import { API, servidor } from "../../pruebas/servidor";
import { guardarSesion } from "../../sesion/almacen";
import { alcanceInsumo, alcanceReceta } from "./alcance";
import { costoPromedioNuevo } from "./VentanasAlmacen";

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
    await irPorMenu(userEvent.setup(), "Planta", "Almacén");

    expect(ubicacion()).toBe("/almacen");
    const tabla = await screen.findByRole("table", { name: "Insumos" });
    // Tipo kardex: Insumo | Stock (cantidad grande) | Estado (etiqueta) | Costo promedio | Valor | Último | Acciones
    await waitFor(() => expect(celdas(tabla, "Cuajo líquido")[2]).toBe("Alcanza para ≈ 750 L (Queso paria)"));
    expect(celdas(tabla, "Cuajo líquido")[1]).toBe("150 ml");
    expect(celdas(tabla, "Cuajo líquido").slice(3, 6)).toEqual(["S/ 0.0800 / ml", "S/ 12.00", "03/10/2026 09:00"]);
    const cuajo = within(tabla).getByText("Cuajo líquido").closest("tr")!;
    expect(cuajo.querySelector(".kardex-cantidad")).toHaveTextContent("150");
    expect(within(cuajo).getByText("Alcanza para ≈ 750 L")).toHaveClass("insignia-ok");
    expect(celdas(tabla, "Azúcar")[0]).toBe("Azúcar");
    expect(celdas(tabla, "Azúcar")[2]).toBe("Sin stock");
    expect(within(within(tabla).getByText("Azúcar").closest("tr")!).getByText("Sin stock")).toHaveClass("insignia-error");
    expect(celdas(tabla, "Etiquetas")[2]).toBe("Ninguna receta lo usa");
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
    expect(celdas(tabla, "Sal")[2]).toBe("");
  });
});

describe("recetas", () => {
  it("el menú lleva a Recetas: unidad, precio, rendimiento y vida útil, insumos por 100 L con su costo y alcance", async () => {
    simular();
    renderizar("/");
    await irPorMenu(userEvent.setup(), "Planta", "Recetas");

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

describe("compras de insumos", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 9, 19, 4, 30));   // 23:30 del 18/10 en Lima
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** API de insumos con compras y altas; cuenta cuántas veces se pidió la lista. */
  function simularCompras() {
    const enviado = { compras: [] as { id: string; cuerpo: IngresoInsumo }[], nuevos: [] as InsumoNuevo[], listas: 0 };
    servidor.use(
      http.get(`${API}/insumos`, () => { enviado.listas += 1; return HttpResponse.json(INSUMOS); }),
      http.get(`${API}/recetas`, () => HttpResponse.json(RECETAS)),
      http.post(`${API}/insumos/:id/ingresos`, async ({ params, request }) => {
        enviado.compras.push({ id: String(params.id), cuerpo: (await request.json()) as IngresoInsumo });
        return HttpResponse.json({ movimiento_id: 77, insumo: { ...INSUMOS[0]!, stock: 200, costo_unitario: 0.085 } }, { status: 201 });
      }),
      http.post(`${API}/insumos`, async ({ request }) => {
        const datos = (await request.json()) as InsumoNuevo;
        enviado.nuevos.push(datos);
        return HttpResponse.json({ insumo_id: 20, nombre: datos.nombre, unidad: datos.unidad, stock: 0, estado: "sin_stock",
                                   costo_unitario: 0, ultima_actualizacion: null } satisfies InsumoStock, { status: 201 });
      }),
    );
    return enviado;
  }

  function cambiarFecha(ventana: HTMLElement, valor: string) {
    fireEvent.change(within(ventana).getByLabelText("Fecha de la compra"), { target: { value: valor } });
  }

  it("costo promedio que se muestra antes de confirmar: la fórmula de fn_movimiento_insumo", () => {
    expect(costoPromedioNuevo(100, 0.5, 50, 0.8)).toBe(0.6);
    expect(costoPromedioNuevo(-5, 0.5, 10, 1)).toBe(1);      // stock negativo cuenta como 0
    expect(costoPromedioNuevo(0, 0, 10, 2)).toBe(2);
    expect(costoPromedioNuevo(3, 1, 7, 0.33333)).toBe(0.5333);   // 4 decimales, como round(...,4)
  });

  it("registrar compra: dice cuánto sube el stock, el costo promedio nuevo, el flujo y que no se borra", async () => {
    const enviado = simularCompras();
    renderizar("/almacen");
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole("button", { name: "Registrar compra de Cuajo líquido" }));
    const ventana = screen.getByRole("dialog", { name: "Registrar compra: Cuajo líquido" });
    expect(ventana).toHaveTextContent("Escriba la cantidad y el costo para ver cómo cambian");

    await usuario.type(within(ventana).getByLabelText("Cantidad (ml)"), "50");
    await usuario.type(within(ventana).getByLabelText("Costo por ml (S/)"), "0.1");
    expect(within(ventana).getByLabelText("Fecha de la compra")).toHaveValue("2026-10-18");
    expect(ventana).toHaveTextContent("El stock sube de 150 a 200 ml (compra de S/ 5.00).");
    expect(ventana).toHaveTextContent("Costo promedio: de S/ 0.0800 a S/ 0.0850 por ml (lo recalcula la base).");
    expect(ventana).toHaveTextContent("Cuenta en el flujo de caja del mes como compra de insumos; en el resultado entra recién");
    expect(ventana).toHaveTextContent("El movimiento no se puede borrar desde el panel.");
    await usuario.type(within(ventana).getByLabelText("Nota (opcional)"), " Factura 0012 ");
    await usuario.click(within(ventana).getByRole("button", { name: "Registrar compra" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(enviado.compras).toEqual([{ id: "1", cuerpo: { cantidad: 50, costo_unitario: 0.1, fecha: null, nota: "Factura 0012" } }]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Compra registrada: Cuajo líquido queda con 200 ml a un costo promedio de S/ 0.0850 por ml.");
    await waitFor(() => expect(enviado.listas).toBe(2));
  });

  it("valida cantidad, costo y fecha antes de enviar; una fecha pasada viaja y se nombra en el texto", async () => {
    const enviado = simularCompras();
    renderizar("/almacen");
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole("button", { name: "Registrar compra de Sal" }));
    const ventana = screen.getByRole("dialog");

    await usuario.type(within(ventana).getByLabelText("Cantidad (kg)"), "0");
    await usuario.type(within(ventana).getByLabelText("Costo por kg (S/)"), "1.23456");
    cambiarFecha(ventana, "2026-10-19");
    await usuario.click(within(ventana).getByRole("button", { name: "Registrar compra" }));
    expect(within(ventana).getByLabelText("Cantidad (kg)")).toHaveAccessibleDescription(/^Cantidad mayor que cero/);
    expect(within(ventana).getByLabelText("Costo por kg (S/)")).toHaveAccessibleDescription(/^Costo mayor que cero/);
    expect(within(ventana).getByLabelText("Fecha de la compra")).toHaveAccessibleDescription(/Elija una fecha que no sea futura/);
    expect(enviado.compras).toEqual([]);

    await usuario.clear(within(ventana).getByLabelText("Cantidad (kg)"));
    await usuario.type(within(ventana).getByLabelText("Cantidad (kg)"), "10");
    await usuario.clear(within(ventana).getByLabelText("Costo por kg (S/)"));
    await usuario.type(within(ventana).getByLabelText("Costo por kg (S/)"), "1.6");
    cambiarFecha(ventana, "2026-09-30");
    expect(ventana).toHaveTextContent("Cuenta en el flujo de caja del mes del 30/09/2026");
    await usuario.click(within(ventana).getByRole("button", { name: "Registrar compra" }));
    await waitFor(() => expect(enviado.compras).toEqual(
      [{ id: "3", cuerpo: { cantidad: 10, costo_unitario: 1.6, fecha: "2026-09-30", nota: null } }]));
  });

  it("el 409 de la base se muestra en la ventana", async () => {
    simularCompras();
    servidor.use(http.post(`${API}/insumos/:id/ingresos`, () =>
      HttpResponse.json({ codigo: "conflicto", mensaje: "Un ingreso necesita un costo unitario mayor que cero" }, { status: 409 })));
    renderizar("/almacen");
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole("button", { name: "Registrar compra de Sal" }));
    const ventana = screen.getByRole("dialog");
    await usuario.type(within(ventana).getByLabelText("Cantidad (kg)"), "1");
    await usuario.type(within(ventana).getByLabelText("Costo por kg (S/)"), "1");
    await usuario.click(within(ventana).getByRole("button", { name: "Registrar compra" }));
    expect(await within(ventana).findByRole("alert")).toHaveTextContent("Un ingreso necesita un costo unitario mayor que cero");
  });

  it("nuevo insumo: exige nombre y unidad, nace sin stock; el nombre repetido muestra el 409", async () => {
    const enviado = simularCompras();
    renderizar("/almacen");
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole("button", { name: "Nuevo insumo" }));
    const ventana = screen.getByRole("dialog", { name: "Nuevo insumo" });
    await usuario.click(within(ventana).getByRole("button", { name: "Crear insumo" }));
    expect(within(ventana).getByLabelText("Nombre")).toHaveAccessibleDescription(/Escriba el nombre/);
    expect(within(ventana).getByLabelText("Unidad")).toHaveAccessibleDescription(/Elija la unidad/);
    expect(enviado.nuevos).toEqual([]);

    await usuario.type(within(ventana).getByLabelText("Nombre"), " Cultivo termófilo ");
    await usuario.selectOptions(within(ventana).getByLabelText("Unidad"), "Gramos (g)");
    await usuario.click(within(ventana).getByRole("button", { name: "Crear insumo" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(enviado.nuevos).toEqual([{ nombre: "Cultivo termófilo", unidad: "g" }]);
    expect(screen.getByRole("status")).toHaveTextContent("Insumo Cultivo termófilo creado sin stock: registre su primera compra.");
    await waitFor(() => expect(enviado.listas).toBe(2));

    servidor.use(http.post(`${API}/insumos`, () =>
      HttpResponse.json({ codigo: "conflicto", mensaje: "Ya existe un insumo con ese nombre" }, { status: 409 })));
    await usuario.click(screen.getByRole("button", { name: "Nuevo insumo" }));
    const otra = screen.getByRole("dialog");
    await usuario.type(within(otra).getByLabelText("Nombre"), "Sal");
    await usuario.selectOptions(within(otra).getByLabelText("Unidad"), "Kilos (kg)");
    await usuario.click(within(otra).getByRole("button", { name: "Crear insumo" }));
    expect(await within(otra).findByRole("alert")).toHaveTextContent("Ya existe un insumo con ese nombre");
  });
});
