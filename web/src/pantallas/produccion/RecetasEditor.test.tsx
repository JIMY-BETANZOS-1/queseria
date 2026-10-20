import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import type { InsumoStock, Receta } from "../../api/tipos";
import { respuestaLogin } from "../../pruebas/datos";
import { renderizar } from "../../pruebas/renderizar";
import { API, servidor } from "../../pruebas/servidor";
import { guardarSesion } from "../../sesion/almacen";

beforeEach(() => {
  guardarSesion(respuestaLogin());
});

const INSUMOS: InsumoStock[] = [
  { insumo_id: 1, nombre: "Cuajo líquido", unidad: "ml", stock: 150, estado: "disponible", costo_unitario: 0.08, ultima_actualizacion: null },
  { insumo_id: 3, nombre: "Sal", unidad: "kg", stock: 50, estado: "disponible", costo_unitario: 1.5, ultima_actualizacion: null },
  { insumo_id: 6, nombre: "Azúcar", unidad: "kg", stock: 16, estado: "disponible", costo_unitario: 3.8, ultima_actualizacion: null },
];

// Queso paria: ya tiene lotes. Yogurt: sin lotes, escrito para 50 L.
const PARIA: Receta = { id: 1, nombre: "Queso paria", unidad_venta: "unidad", precio_venta: 20, litros_base: 100, rendimiento_base: 11,
  dias_vida_util: 30, activa: true, n_lotes: 2,
  insumos: [{ insumo_id: 1, nombre: "Cuajo líquido", unidad: "ml", cantidad: 20 }, { insumo_id: 3, nombre: "Sal", unidad: "kg", cantidad: 1.5 }] };
const YOGURT: Receta = { id: 4, nombre: "Yogurt", unidad_venta: "kilo", precio_venta: 7, litros_base: 50, rendimiento_base: 52.5,
  dias_vida_util: null, activa: true, n_lotes: 0, insumos: [{ insumo_id: 6, nombre: "Azúcar", unidad: "kg", cantidad: 4 }] };

function simular(especial?: () => Response) {
  const enviado = { listas: 0, orden: [] as string[], creadas: [] as unknown[], cambios: [] as { id: string; cuerpo: unknown }[],
                    insumos: [] as { id: string; cuerpo: unknown }[] };
  servidor.use(
    http.get(`${API}/recetas`, () => { enviado.listas += 1; return HttpResponse.json([PARIA, YOGURT]); }),
    http.get(`${API}/insumos`, () => HttpResponse.json(INSUMOS)),
    http.post(`${API}/recetas`, async ({ request }) => {
      enviado.orden.push("post");
      const cuerpo = (await request.json()) as Receta;
      enviado.creadas.push(cuerpo);
      return especial?.() ?? HttpResponse.json({ ...YOGURT, ...cuerpo, id: 30, n_lotes: 0, insumos: [] }, { status: 201 });
    }),
    http.patch(`${API}/recetas/:id`, async ({ params, request }) => {
      enviado.orden.push("patch");
      const cuerpo = await request.json();
      enviado.cambios.push({ id: String(params.id), cuerpo });
      return especial?.() ?? HttpResponse.json({ ...(params.id === "1" ? PARIA : YOGURT), ...(cuerpo as object) });
    }),
    http.put(`${API}/recetas/:id/insumos`, async ({ params, request }) => {
      enviado.orden.push("put");
      const cuerpo = await request.json();
      enviado.insumos.push({ id: String(params.id), cuerpo });
      return HttpResponse.json(params.id === "1" ? PARIA : YOGURT);
    }),
  );
  return enviado;
}

async function abrirPantalla() {
  renderizar("/recetas");
  await screen.findByRole("heading", { name: "Queso paria" });
  return userEvent.setup();
}

describe("editor de recetas", () => {
  it("nueva receta: cabecera, insumos, vista previa de costo por 100 L y alcance; envía todo y recarga", async () => {
    const enviado = simular();
    const usuario = await abrirPantalla();
    await usuario.click(screen.getByRole("button", { name: "Nueva receta" }));
    const v = screen.getByRole("dialog", { name: "Nueva receta" });

    await usuario.type(within(v).getByLabelText("Nombre"), " Yogurt de fresa ");
    await usuario.selectOptions(within(v).getByLabelText("Se vende por"), "Kilo (yogurt)");
    await usuario.clear(within(v).getByLabelText("Litros base"));
    await usuario.type(within(v).getByLabelText("Litros base"), "50");
    await usuario.type(within(v).getByLabelText("Rendimiento (kilos, opcional)"), "52.5");
    await usuario.type(within(v).getByLabelText("Precio de venta (S/, opcional)"), "8.5");
    await usuario.click(within(v).getByRole("button", { name: "Agregar insumo" }));
    await usuario.selectOptions(within(v).getByLabelText("Insumo 1"), "Azúcar");
    await usuario.type(within(v).getByLabelText("Cantidad del insumo 1"), "4");
    await usuario.click(within(v).getByRole("button", { name: "Agregar insumo" }));
    // El insumo ya elegido no se puede repetir
    expect(within(within(v).getByLabelText("Insumo 2")).getByRole("option", { name: "Azúcar" })).toBeDisabled();
    await usuario.selectOptions(within(v).getByLabelText("Insumo 2"), "Cuajo líquido");
    await usuario.type(within(v).getByLabelText("Cantidad del insumo 2"), "5");

    // 4 kg / 50 L = 8 kg por 100 L × 3.8 = 30.40; 5 ml / 50 L = 10 ml × 0.08 = 0.80. Azúcar 16 kg → 200 L; cuajo 150 ml → 1500 L
    const tabla = within(v).getByRole("table", { name: "Insumos de la receta" });
    expect(within(tabla).getAllByRole("row")[1]).toHaveTextContent("kgS/ 30.40");
    expect(v).toHaveTextContent("Vista previa: insumos por 100 L S/ 31.20 · con el stock de hoy alcanza para ≈ 200 L de leche · rinde 105 kilos por 100 L");
    await usuario.click(within(v).getByRole("button", { name: "Crear receta" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(enviado.creadas).toEqual([{ nombre: "Yogurt de fresa", unidad_venta: "kilo", precio_venta: 8.5, litros_base: 50, rendimiento_base: 52.5,
                                       dias_vida_util: null, activa: true, insumos: [{ insumo_id: 6, cantidad: 4 }, { insumo_id: 1, cantidad: 5 }] }]);
    expect(screen.getByRole("status")).toHaveTextContent("Receta Yogurt de fresa creada.");
    await waitFor(() => expect(enviado.listas).toBe(2));
  });

  it("valida antes de enviar: nombre, litros base, insumo elegido y cantidad", async () => {
    const enviado = simular();
    const usuario = await abrirPantalla();
    await usuario.click(screen.getByRole("button", { name: "Nueva receta" }));
    const v = screen.getByRole("dialog");
    await usuario.clear(within(v).getByLabelText("Litros base"));
    await usuario.type(within(v).getByLabelText("Litros base"), "0");
    await usuario.click(within(v).getByRole("button", { name: "Agregar insumo" }));
    await usuario.type(within(v).getByLabelText("Cantidad del insumo 1"), "1.2345");
    await usuario.click(within(v).getByRole("button", { name: "Crear receta" }));
    expect(within(v).getByLabelText("Nombre")).toHaveAccessibleDescription("Escriba el nombre");
    expect(within(v).getByLabelText("Litros base")).toHaveAccessibleDescription(/^Litros mayores que cero/);
    expect(within(v).getByLabelText("Insumo 1")).toHaveAccessibleDescription("Elija el insumo");
    expect(within(v).getByLabelText("Cantidad del insumo 1")).toHaveAccessibleDescription(/^Cantidad mayor que cero/);
    await usuario.click(within(v).getByRole("button", { name: "Quitar insumo 1" }));
    expect(within(v).getByText("Sin insumos.")).toBeInTheDocument();
    expect(enviado.creadas).toEqual([]);
  });

  it("editar sin lotes: manda solo lo que cambió (cabecera y luego insumos); sin cambios no envía nada", async () => {
    const enviado = simular();
    const usuario = await abrirPantalla();
    await usuario.click(screen.getByRole("button", { name: "Editar Yogurt" }));
    const v = screen.getByRole("dialog", { name: "Editar receta: Yogurt" });
    expect(within(v).getByLabelText("Litros base")).toBeEnabled();
    await usuario.click(within(v).getByRole("button", { name: "Guardar cambios" }));
    expect(within(v).getByRole("alert")).toHaveTextContent("No hay cambios que guardar.");
    expect(enviado.orden).toEqual([]);

    await usuario.clear(within(v).getByLabelText("Precio de venta (S/, opcional)"));
    await usuario.type(within(v).getByLabelText("Precio de venta (S/, opcional)"), "7.5");
    await usuario.clear(within(v).getByLabelText("Cantidad del insumo 1"));
    await usuario.type(within(v).getByLabelText("Cantidad del insumo 1"), "3.5");
    await usuario.click(within(v).getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(enviado.orden).toEqual(["patch", "put"]);
    expect(enviado.cambios).toEqual([{ id: "4", cuerpo: { precio_venta: 7.5 } }]);
    expect(enviado.insumos).toEqual([{ id: "4", cuerpo: { insumos: [{ insumo_id: 6, cantidad: 3.5 }] } }]);
    expect(screen.getByRole("status")).toHaveTextContent("Receta Yogurt guardada.");
  });

  it("editar con lotes: los 4 campos protegidos se ven deshabilitados con su nota; el precio sí se cambia", async () => {
    const enviado = simular();
    const usuario = await abrirPantalla();
    await usuario.click(screen.getByRole("button", { name: "Editar Queso paria" }));
    const v = screen.getByRole("dialog", { name: "Editar receta: Queso paria" });
    expect(v).toHaveTextContent("Esta receta ya tiene 2 lotes: la unidad de venta, los litros base, el rendimiento y la vida útil no se cambian");
    expect(v).toHaveTextContent("use «Duplicar como nueva» y desactive esta");
    for (const etiqueta of ["Se vende por", "Litros base", "Rendimiento (unidades, opcional)", "Vida útil (días, opcional)"]) {
      expect(within(v).getByLabelText(etiqueta)).toBeDisabled();
    }
    expect(within(v).getByLabelText("Nombre")).toBeEnabled();
    expect(within(v).getByLabelText("Precio de venta (S/, opcional)")).toBeEnabled();
    expect(within(v).getByLabelText("Insumo 1")).toBeEnabled();

    await usuario.clear(within(v).getByLabelText("Precio de venta (S/, opcional)"));
    await usuario.type(within(v).getByLabelText("Precio de venta (S/, opcional)"), "22");
    await usuario.click(within(v).getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(enviado.cambios).toEqual([{ id: "1", cuerpo: { precio_venta: 22 } }]));
    expect(enviado.insumos).toEqual([]);
  });

  it("duplicar como nueva: abre la creación con los datos e insumos de la receta (campos habilitados)", async () => {
    const enviado = simular();
    const usuario = await abrirPantalla();
    await usuario.click(screen.getByRole("button", { name: "Duplicar Queso paria como nueva" }));
    const v = screen.getByRole("dialog", { name: "Nueva receta (copia de Queso paria)" });
    expect(within(v).getByLabelText("Nombre")).toHaveValue("Queso paria (copia)");
    expect(within(v).getByLabelText("Vida útil (días, opcional)")).toBeEnabled();
    expect(within(v).getByLabelText("Vida útil (días, opcional)")).toHaveValue("30");
    expect(v).not.toHaveTextContent("Esta receta ya tiene");
    await usuario.clear(within(v).getByLabelText("Vida útil (días, opcional)"));
    await usuario.type(within(v).getByLabelText("Vida útil (días, opcional)"), "45");
    await usuario.click(within(v).getByRole("button", { name: "Crear receta" }));
    await waitFor(() => expect(enviado.creadas).toEqual([{ nombre: "Queso paria (copia)", unidad_venta: "unidad", precio_venta: 20,
      litros_base: 100, rendimiento_base: 11, dias_vida_util: 45, activa: true,
      insumos: [{ insumo_id: 1, cantidad: 20 }, { insumo_id: 3, cantidad: 1.5 }] }]));
  });

  it("el 409 de la base o del backend se muestra tal cual en la ventana", async () => {
    simular(() => HttpResponse.json({ codigo: "conflicto", mensaje: "Ya existe una receta con ese nombre" }, { status: 409 }));
    const usuario = await abrirPantalla();
    await usuario.click(screen.getByRole("button", { name: "Duplicar Yogurt como nueva" }));
    const v = screen.getByRole("dialog");
    await usuario.click(within(v).getByRole("button", { name: "Crear receta" }));
    expect((await within(v).findByRole("alert")).textContent).toBe("Ya existe una receta con ese nombre");
  });
});
