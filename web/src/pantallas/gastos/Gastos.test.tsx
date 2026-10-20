import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CategoriaGasto, Gasto, GastoNuevo } from "../../api/tipos";
import { respuestaLogin } from "../../pruebas/datos";
import { acopiador } from "../../pruebas/fabricas";
import { renderizar, ubicacion } from "../../pruebas/renderizar";
import { API, servidor } from "../../pruebas/servidor";
import { guardarSesion } from "../../sesion/almacen";

beforeEach(() => {
  guardarSesion(respuestaLogin());
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 19, 4, 30));   // 23:30 del 18/10 en Lima
});

afterEach(() => {
  vi.useRealTimers();
});

const CATEGORIAS: CategoriaGasto[] = [
  { id: 4, nombre: "Alquiler", manual: true },
  { id: 1, nombre: "Combustible", manual: true },
  { id: 7, nombre: "Otros", manual: true },
  { id: 2, nombre: "Sueldo acopiador", manual: false },
];

function gasto(cambios: Partial<Gasto> = {}): Gasto {
  return { id: 1, fecha: "2026-10-10", categoria_id: 1, categoria: "Combustible", descripcion: "Gasolina", monto: 45.5,
           acopiador_id: 7, acopiador: "Juan Carlos Mamani Quispe", registrado_por: 1,
           registrado_por_nombre: "Administrador de Prueba", creado_en: "2026-10-10T10:00:00-05:00", del_pago_mensual: false,
           ...cambios };
}

const GASTOS = [
  gasto(),
  gasto({ id: 2, fecha: "2026-10-05", categoria_id: 2, categoria: "Sueldo acopiador", descripcion: "Sueldo de Juan (09/2026)",
          monto: 957.5, del_pago_mensual: true }),
  gasto({ id: 3, fecha: "2026-10-02", categoria_id: 1, descripcion: null, monto: 30, acopiador_id: null, acopiador: null }),
];

function simular(lista: Gasto[] = GASTOS) {
  const enviado = { consultas: [] as string[], nuevos: [] as GastoNuevo[] };
  servidor.use(
    http.get(`${API}/categorias-gasto`, () => HttpResponse.json(CATEGORIAS)),
    http.get(`${API}/acopiadores`, () => HttpResponse.json([acopiador(), acopiador({ id: 9, nombre_completo: "Inactivo", activo: false })])),
    http.get(`${API}/gastos`, ({ request }) => {
      enviado.consultas.push(new URL(request.url).search);
      return HttpResponse.json(lista);
    }),
    http.post(`${API}/gastos`, async ({ request }) => {
      const datos = (await request.json()) as GastoNuevo;
      enviado.nuevos.push(datos);
      return HttpResponse.json(gasto({ id: 10 }), { status: 201 });
    }),
  );
  return enviado;
}

describe("gastos", () => {
  it("el menú lleva a Gastos: el mes actual en Lima, con total por categoría y marca del pago mensual", async () => {
    const enviado = simular();
    renderizar("/");
    await userEvent.setup().click(within(screen.getByRole("navigation", { name: "Menú principal" }))
      .getByRole("link", { name: "Gastos" }));

    expect(ubicacion()).toBe("/gastos");
    const tabla = await screen.findByRole("table", { name: "Gastos" });
    expect(enviado.consultas).toEqual(["?desde=2026-10-01&hasta=2026-10-18"]);
    expect(screen.getByText(/Total: S\/ 1,033.00/).closest("p"))
      .toHaveTextContent("Total: S/ 1,033.00 (Sueldo acopiador: S/ 957.50 · Combustible: S/ 75.50)");
    const filas = within(tabla).getAllByRole("row").slice(1).map((f) => within(f).getAllByRole("cell").map((c) => c.textContent));
    expect(filas[0]).toEqual(["10/10/2026", "Combustible", "Gasolina", "Juan Carlos Mamani Quispe", "S/ 45.50", "Administrador de Prueba"]);
    expect(filas[1]![1]).toBe("Sueldo acopiador Pago mensual");
    await waitFor(() => expect(document.title).toBe("Gastos · Quesería Huata"));
  });

  it("el formulario no ofrece 'Sueldo acopiador' ni acopiadores inactivos", async () => {
    simular();
    renderizar("/gastos");
    await screen.findByRole("table", { name: "Gastos" });
    const categorias = within(screen.getByLabelText("Categoría")).getAllByRole("option").map((o) => o.textContent);
    expect(categorias).toEqual(["Elija…", "Alquiler", "Combustible", "Otros"]);
    const acopiadores = within(screen.getByLabelText("Acopiador (opcional)")).getAllByRole("option").map((o) => o.textContent);
    expect(acopiadores).toEqual(["Ninguno", "Juan Carlos Mamani Quispe"]);
  });

  it("valida categoría y monto antes de confirmar", async () => {
    const enviado = simular();
    renderizar("/gastos");
    const usuario = userEvent.setup();
    await screen.findByRole("table", { name: "Gastos" });

    await usuario.type(screen.getByLabelText("Monto (S/)"), "0");
    await usuario.click(screen.getByRole("button", { name: "Registrar gasto" }));
    expect(screen.getByLabelText("Categoría")).toHaveAccessibleDescription("Elija la categoría");
    expect(screen.getByLabelText("Monto (S/)")).toHaveAccessibleDescription(/^Monto en soles, mayor que cero/);
    await usuario.clear(screen.getByLabelText("Monto (S/)"));
    await usuario.type(screen.getByLabelText("Monto (S/)"), "12.345");
    await usuario.click(screen.getByRole("button", { name: "Registrar gasto" }));
    expect(screen.getByLabelText("Monto (S/)")).toHaveAccessibleDescription(/^Monto en soles/);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(enviado.nuevos).toEqual([]);
  });

  it("registrar: confirma que no se puede editar ni eliminar, envía los datos y recarga la lista", async () => {
    const enviado = simular();
    renderizar("/gastos");
    const usuario = userEvent.setup();
    await screen.findByRole("table", { name: "Gastos" });
    expect(screen.getByLabelText("Fecha")).toHaveValue("2026-10-18");

    await usuario.selectOptions(screen.getByLabelText("Categoría"), "Combustible");
    await usuario.type(screen.getByLabelText("Monto (S/)"), "60.5");
    await usuario.selectOptions(screen.getByLabelText("Acopiador (opcional)"), "Juan Carlos Mamani Quispe");
    await usuario.type(screen.getByLabelText("Descripción (opcional)"), "  Gasolina ruta 4 ");
    await usuario.click(screen.getByRole("button", { name: "Registrar gasto" }));

    const ventana = screen.getByRole("dialog", { name: "Registrar gasto" });
    expect(ventana).toHaveTextContent("Combustible: S/ 60.50 el 18/10/2026, de Juan Carlos Mamani Quispe.");
    expect(ventana).toHaveTextContent("Cuenta en el flujo de caja y en el resultado de su mes.");
    expect(ventana).toHaveTextContent("No se puede editar ni eliminar desde el panel.");
    await usuario.click(within(ventana).getByRole("button", { name: "Registrar gasto" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(enviado.nuevos).toEqual([{ fecha: "2026-10-18", categoria_id: 1, monto: 60.5, acopiador_id: 7, descripcion: "Gasolina ruta 4" }]);
    expect(screen.getByRole("status")).toHaveTextContent("Gasto de S/ 60.50 en Combustible registrado.");
    await waitFor(() => expect(enviado.consultas).toHaveLength(2));
    expect(screen.getByLabelText("Monto (S/)")).toHaveValue("");
  });

  it("sin acopiador ni descripción los envía como null; el 409 de la base se muestra en la ventana", async () => {
    const enviado = simular();
    servidor.use(http.post(`${API}/gastos`, async ({ request }) => {
      enviado.nuevos.push((await request.json()) as GastoNuevo);
      return HttpResponse.json({ codigo: "conflicto", mensaje: "El monto del gasto debe ser mayor que cero" }, { status: 409 });
    }));
    renderizar("/gastos");
    const usuario = userEvent.setup();
    await screen.findByRole("table", { name: "Gastos" });

    await usuario.selectOptions(screen.getByLabelText("Categoría"), "Otros");
    await usuario.type(screen.getByLabelText("Monto (S/)"), "5");
    await usuario.click(screen.getByRole("button", { name: "Registrar gasto" }));
    await usuario.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Registrar gasto" }));

    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent("El monto del gasto debe ser mayor que cero");
    expect(enviado.nuevos).toEqual([{ fecha: "2026-10-18", categoria_id: 7, monto: 5, acopiador_id: null, descripcion: null }]);
  });

  it("el rango se valida antes de pedir y queda en la URL", async () => {
    const enviado = simular([]);
    renderizar("/gastos");
    const usuario = userEvent.setup();
    expect(await screen.findByText("No hay gastos en ese periodo.")).toBeInTheDocument();

    await usuario.clear(screen.getByLabelText("Hasta"));
    await usuario.type(screen.getByLabelText("Hasta"), "2026-09-01");
    await usuario.click(screen.getByRole("button", { name: "Ver" }));
    expect(screen.getByLabelText("Hasta")).toHaveAccessibleDescription("No puede ser anterior a la fecha inicial");
    expect(enviado.consultas).toHaveLength(1);

    await usuario.clear(screen.getByLabelText("Desde"));
    await usuario.type(screen.getByLabelText("Desde"), "2026-09-01");
    await usuario.click(screen.getByRole("button", { name: "Ver" }));
    expect(ubicacion()).toBe("/gastos?desde=2026-09-01&hasta=2026-09-01");
    await waitFor(() => expect(enviado.consultas.at(-1)).toBe("?desde=2026-09-01&hasta=2026-09-01"));
  });
});
