import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Parametro, Precio, PrecioNuevo } from "../../api/tipos";
import { respuestaLogin } from "../../pruebas/datos";
import { renderizar, ubicacion } from "../../pruebas/renderizar";
import { API, servidor } from "../../pruebas/servidor";
import { guardarSesion } from "../../sesion/almacen";
import { preciosVigentes } from "./Configuracion";

beforeEach(() => {
  guardarSesion(respuestaLogin());
  // 23:30 del 18/10 en Lima (04:30 UTC del 19; las pruebas corren en Tokio): hoy es el 18
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 19, 4, 30));
});

afterEach(() => {
  vi.useRealTimers();
});

function precio(id: number, tipo: "normal" | "sancion", precio_litro: number, vigente_desde: string, autor: string | null = null): Precio {
  return { id, tipo, precio_litro, vigente_desde, creado_por: autor ? 1 : null, creado_por_nombre: autor,
           creado_en: "2026-01-01T09:00:00-05:00" };
}

const PRECIOS = [
  precio(5, "normal", 1.9, "2026-11-01", "Administrador de Prueba"),
  precio(4, "normal", 1.8, "2026-10-18", "Administrador de Prueba"),
  precio(1, "normal", 1.7, "2026-01-01"),
  precio(2, "sancion", 0.7, "2026-01-01"),
];
const PARAMETROS: Parametro[] = [
  { clave: "dias_sancion", valor: "7", descripcion: "Duración de la sanción de precio y del bloqueo, en días" },
  { clave: "pagar_leche_alterada", valor: "true", descripcion: "true = la leche alterada del día se paga" },
  { clave: "color_externo", valor: "#6B7280", descripcion: "Color con el que se muestran los productores externos" },
  { clave: "empresa_nombre", valor: "Quesería Huata", descripcion: "Nombre que aparece en reportes y comprobantes" },
];

function simular() {
  const enviado = { precios: [] as PrecioNuevo[], parametros: [] as { clave: string; valor: string }[] };
  let parametros = PARAMETROS;
  servidor.use(
    http.get(`${API}/precios-leche`, () => HttpResponse.json(PRECIOS)),
    http.post(`${API}/precios-leche`, async ({ request }) => {
      const datos = (await request.json()) as PrecioNuevo;
      enviado.precios.push(datos);
      return HttpResponse.json(precio(9, datos.tipo, datos.precio_litro, datos.vigente_desde, "Administrador de Prueba"), { status: 201 });
    }),
    http.get(`${API}/configuracion`, () => HttpResponse.json(parametros)),
    http.put(`${API}/configuracion/:clave`, async ({ params, request }) => {
      const { valor } = (await request.json()) as { valor: string };
      enviado.parametros.push({ clave: String(params.clave), valor });
      parametros = parametros.map((p) => (p.clave === params.clave ? { ...p, valor } : p));
      return HttpResponse.json(parametros.find((p) => p.clave === params.clave));
    }),
  );
  return enviado;
}

describe("configuración: precio de la leche", () => {
  it("el menú lleva a Configuración; el historial marca el vigente de cada tipo y el programado", async () => {
    simular();
    renderizar("/");
    await userEvent.setup().click(within(screen.getByRole("navigation", { name: "Menú principal" }))
      .getByRole("link", { name: "Configuración" }));

    expect(ubicacion()).toBe("/configuracion");
    const tabla = await screen.findByRole("table", { name: "Historial de precios" });
    const filas = within(tabla).getAllByRole("row").slice(1).map((f) => within(f).getAllByRole("cell").map((c) => c.textContent));
    expect(filas.map((f) => [f[0], f[1], f[2], f[4]])).toEqual([
      ["Normal", "S/ 1.90", "01/11/2026", "Programado"],
      ["Normal", "S/ 1.80", "18/10/2026", "Vigente"],
      ["Normal", "S/ 1.70", "01/01/2026", "Anterior"],
      ["Sanción", "S/ 0.70", "01/01/2026", "Vigente"],
    ]);
    expect(filas[2]![3]).toContain("Carga inicial");
  });

  it("valida el precio antes de confirmar", async () => {
    const enviado = simular();
    renderizar("/configuracion");
    const usuario = userEvent.setup();
    await screen.findByRole("table", { name: "Historial de precios" });

    for (const malo of ["0", "1.2345", "abc"]) {
      await usuario.clear(screen.getByLabelText("Precio por litro (S/)"));
      await usuario.type(screen.getByLabelText("Precio por litro (S/)"), malo);
      await usuario.click(screen.getByRole("button", { name: "Registrar precio" }));
      expect(screen.getByLabelText("Precio por litro (S/)")).toHaveAccessibleDescription(/^Soles por litro, mayor que cero/);
    }
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(enviado.precios).toEqual([]);
  });

  it("registrar: confirma qué cambia (incluido lo no liquidado) y envía tipo, precio y fecha", async () => {
    const enviado = simular();
    renderizar("/configuracion");
    const usuario = userEvent.setup();
    await screen.findByRole("table", { name: "Historial de precios" });

    await usuario.selectOptions(screen.getByLabelText("Tipo"), "Sanción");
    await usuario.type(screen.getByLabelText("Precio por litro (S/)"), "0.75");
    expect(screen.getByLabelText("Vigente desde")).toHaveValue("2026-10-18");
    await usuario.click(screen.getByRole("button", { name: "Registrar precio" }));

    const ventana = screen.getByRole("dialog", { name: "Registrar precio de la leche" });
    expect(ventana).toHaveTextContent("Desde el 18/10/2026, la leche con sanción se paga a S/ 0.75 por litro.");
    expect(ventana).toHaveTextContent("Cambia también el monto de las entregas desde esa fecha que todavía no estén liquidadas");
    expect(ventana).not.toHaveTextContent("anterior a hoy");
    expect(ventana).toHaveTextContent("El historial no se edita ni se borra.");
    await usuario.click(within(ventana).getByRole("button", { name: "Registrar precio" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(enviado.precios).toEqual([{ tipo: "sancion", precio_litro: 0.75, vigente_desde: "2026-10-18" }]);
    expect(screen.getByRole("status")).toHaveTextContent("Precio sanción de S/ 0.75 registrado desde el 18/10/2026.");
  });

  it("con una fecha pasada avisa que afecta entregas ya registradas; el 409 de la base se muestra", async () => {
    simular();
    servidor.use(http.post(`${API}/precios-leche`, () => HttpResponse.json(
      { codigo: "conflicto", mensaje: "Ya existe un precio de ese tipo con esa fecha de vigencia" }, { status: 409 })));
    renderizar("/configuracion");
    const usuario = userEvent.setup();
    await screen.findByRole("table", { name: "Historial de precios" });

    await usuario.type(screen.getByLabelText("Precio por litro (S/)"), "1.75");
    await usuario.clear(screen.getByLabelText("Vigente desde"));
    await usuario.type(screen.getByLabelText("Vigente desde"), "2026-10-01");
    await usuario.click(screen.getByRole("button", { name: "Registrar precio" }));
    const ventana = screen.getByRole("dialog");
    expect(ventana).toHaveTextContent("La fecha es anterior a hoy: afecta entregas ya registradas.");

    await usuario.click(within(ventana).getByRole("button", { name: "Registrar precio" }));
    expect(await within(ventana).findByRole("alert")).toHaveTextContent("Ya existe un precio de ese tipo con esa fecha de vigencia");
  });

  it("preciosVigentes elige el más reciente ya empezado de cada tipo", () => {
    expect([...preciosVigentes(PRECIOS, "2026-10-17")].sort()).toEqual([1, 2]);
    expect([...preciosVigentes(PRECIOS, "2026-11-01")].sort()).toEqual([2, 5]);
  });
});

describe("configuración: parámetros", () => {
  it("muestra descripción, valor y cuándo se aplica cada uno", async () => {
    simular();
    renderizar("/configuracion");
    const tabla = await screen.findByRole("table", { name: "Parámetros" });
    const fila = (clave: string) => within(tabla).getByText(clave).closest("tr")!;

    expect(fila("pagar_leche_alterada")).toHaveTextContent("Sí");
    expect(fila("pagar_leche_alterada")).toHaveTextContent("Cambia al instante el monto de la leche alterada que aún no está liquidada.");
    expect(fila("dias_sancion")).toHaveTextContent("Se aplica a las sanciones que se creen desde ahora; no cambia las vigentes.");
    expect(fila("empresa_nombre")).toHaveTextContent("Se usa al instante en el encabezado del comprobante impreso de cada liquidación.");
  });

  it("número: envía el valor nuevo y repite cuándo se aplica", async () => {
    const enviado = simular();
    renderizar("/configuracion");
    const usuario = userEvent.setup();
    await screen.findByRole("table", { name: "Parámetros" });

    await usuario.click(screen.getByRole("button", { name: "Cambiar dias_sancion" }));
    const ventana = screen.getByRole("dialog", { name: "Cambiar parámetro" });
    expect(ventana).toHaveTextContent("Se aplica a las sanciones que se creen desde ahora");
    expect(within(ventana).getByRole("button", { name: "Guardar" })).toBeDisabled();   // sin cambios
    await usuario.clear(within(ventana).getByLabelText("Valor (dias_sancion)"));
    await usuario.type(within(ventana).getByLabelText("Valor (dias_sancion)"), " 5 ");
    await usuario.click(within(ventana).getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(enviado.parametros).toEqual([{ clave: "dias_sancion", valor: "5" }]);
    expect(screen.getByRole("status")).toHaveTextContent("Parámetro dias_sancion actualizado: 5.");
  });

  it("true/false se elige con Sí/No; el formato lo valida el servidor y su mensaje se muestra", async () => {
    const enviado = simular();
    renderizar("/configuracion");
    const usuario = userEvent.setup();
    await screen.findByRole("table", { name: "Parámetros" });

    await usuario.click(screen.getByRole("button", { name: "Cambiar pagar_leche_alterada" }));
    await usuario.selectOptions(screen.getByLabelText("Valor (pagar_leche_alterada)"), "No");
    await usuario.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(enviado.parametros).toEqual([{ clave: "pagar_leche_alterada", valor: "false" }]));

    servidor.use(http.put(`${API}/configuracion/:clave`, () => HttpResponse.json(
      { codigo: "validacion", mensaje: "El valor de 'dias_sancion' debe ser entero" }, { status: 422 })));
    await usuario.click(screen.getByRole("button", { name: "Cambiar dias_sancion" }));
    const ventana = screen.getByRole("dialog");
    await usuario.clear(within(ventana).getByLabelText("Valor (dias_sancion)"));
    await usuario.type(within(ventana).getByLabelText("Valor (dias_sancion)"), "7.5");
    await usuario.click(within(ventana).getByRole("button", { name: "Guardar" }));
    expect(await within(ventana).findByRole("alert")).toHaveTextContent("El valor de 'dias_sancion' debe ser entero");
  });
});
