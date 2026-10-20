import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Cliente, ClienteNuevo, Jornada, Lote, LoteDisponible, PreviaProduccion, ProduccionRapida, Receta, Venta,
              VentaRapida } from "../../api/tipos";
import { respuestaLogin } from "../../pruebas/datos";
import { irPorMenu } from "../../pruebas/menu";
import { renderizar, ubicacion } from "../../pruebas/renderizar";
import { API, servidor } from "../../pruebas/servidor";
import { guardarSesion } from "../../sesion/almacen";
import { teorico } from "./Produccion";

beforeEach(() => {
  guardarSesion(respuestaLogin());
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 19, 4, 30));   // 23:30 del 18/10 en Lima
});

afterEach(() => {
  vi.useRealTimers();
});

const RECETAS: Receta[] = [
  { id: 1, nombre: "Queso paria", unidad_venta: "unidad", precio_venta: 20, litros_base: 100, rendimiento_base: 11,
    dias_vida_util: 30, activa: true, n_lotes: 0, insumos: [] },
  { id: 4, nombre: "Yogurt", unidad_venta: "kilo", precio_venta: 7, litros_base: 100, rendimiento_base: 105,
    dias_vida_util: 21, activa: true, n_lotes: 0, insumos: [] },
  { id: 9, nombre: "Receta vieja", unidad_venta: "unidad", precio_venta: 1, litros_base: 100, rendimiento_base: 1,
    dias_vida_util: null, activa: false, n_lotes: 0, insumos: [] },
];

function jornada(fecha: string, disponibles: number): Jornada {
  return { fecha, litros_recolectados: 300, litros_descartados: 0, litros_por_revisar: 0, litros_aprobados: 300,
           litros_usados: 300 - disponibles, litros_merma: 0, litros_disponibles: disponibles, costo_pagado: 510,
           costo_litro_util: 1.7, dias_antiguedad: 1, sin_destino: false };
}

function lote(cambios: Partial<Lote> = {}): Lote {
  return { lote_id: 1, codigo: "L-2026-0001", receta_id: 1, receta: "Queso paria", fecha_produccion: "2026-10-18",
           estado: "cerrado", litros_leche: 100, cantidad_producida: 11, cantidad_vendida: 0, saldo: 11, ingresos: 0,
           costo_leche: 170, costo_insumos: 3.5, costo_total: 173.5, costo_por_unidad: 15.77, rendimiento_teorico: 11,
           desviacion_rendimiento_pct: 0, fecha_vencimiento: "2026-11-17", ...cambios };
}

const PREVIA_OK: PreviaProduccion = {
  leche_disponible: 250, costo_litro: 1.7, rendimiento_estimado: 11,
  insumos: [
    { insumo_id: 1, nombre: "Cuajo líquido", unidad: "ml", necesita: 20, hay: 2000, falta: 0 },
    { insumo_id: 3, nombre: "Sal", unidad: "kg", necesita: 1.5, hay: 50, falta: 0 },
  ],
};

function simularProduccion(previa: PreviaProduccion = PREVIA_OK) {
  const enviado = { previas: [] as string[], producidos: [] as ProduccionRapida[] };
  servidor.use(
    http.get(`${API}/recetas`, () => HttpResponse.json(RECETAS)),
    http.get(`${API}/jornadas`, () => HttpResponse.json([jornada("2026-10-16", 0), jornada("2026-10-17", 250)])),
    http.get(`${API}/lotes`, () => HttpResponse.json([lote()])),
    http.get(`${API}/produccion/previa`, ({ request }) => {
      enviado.previas.push(new URL(request.url).search);
      return HttpResponse.json(previa);
    }),
    http.post(`${API}/produccion`, async ({ request }) => {
      enviado.producidos.push((await request.json()) as ProduccionRapida);
      return HttpResponse.json(lote({ lote_id: 2, codigo: "L-2026-0002", cantidad_producida: 10.5 }), { status: 201 });
    }),
  );
  return enviado;
}

async function llenar(usuario: ReturnType<typeof userEvent.setup>, litros = "100", cantidad = "10.5") {
  await usuario.selectOptions(await screen.findByLabelText("Receta"), "Queso paria (unidades)");
  await usuario.selectOptions(screen.getByLabelText("Leche de la jornada"), "17/10/2026: 250 L disponibles");
  await usuario.type(screen.getByLabelText("Litros de leche"), litros);
  await usuario.clear(screen.getByLabelText(/^Cantidad producida/));   // viene propuesta con el rendimiento teórico
  await usuario.type(screen.getByLabelText(/^Cantidad producida/), cantidad);
}

describe("producción", () => {
  it("el menú (grupo Planta) lleva a Producción; solo recetas activas y jornadas con leche disponible", async () => {
    simularProduccion();
    renderizar("/");
    await irPorMenu(userEvent.setup(), "Planta", "Producción");

    expect(ubicacion()).toBe("/produccion");
    const recetas = within(await screen.findByLabelText("Receta")).getAllByRole("option").map((o) => o.textContent);
    expect(recetas).toEqual(["Elija…", "Queso paria (unidades)", "Yogurt (kilos)"]);
    await waitFor(() => expect(within(screen.getByLabelText("Leche de la jornada")).getAllByRole("option")).toHaveLength(2));
    expect(within(screen.getByRole("table", { name: "Lotes" })).getByText("L-2026-0001")).toHaveClass("codigo");
  });

  it("muestra la tabla necesita / hay / falta reponer y deja producir si alcanza todo", async () => {
    const enviado = simularProduccion();
    renderizar("/produccion");
    const usuario = userEvent.setup();
    await llenar(usuario);
    expect(screen.queryByRole("button", { name: "Producir y cerrar lote" })).not.toBeInTheDocument();

    await usuario.click(screen.getByRole("button", { name: "Ver qué se necesita" }));
    const tabla = await screen.findByRole("table", { name: "Insumos del lote" });
    expect(enviado.previas).toEqual(["?receta_id=1&fecha_leche=2026-10-17&litros=100"]);
    expect(within(tabla).getAllByRole("row").slice(1).map((f) => f.textContent))
      .toEqual(["Cuajo líquido20 ml2000 ml—", "Sal1.5 kg50 kg—"]);
    expect(screen.getByLabelText(/^Cantidad producida/)).toHaveAccessibleDescription("Se esperan ≈ 11 unidades.");
    expect(screen.getByRole("button", { name: "Producir y cerrar lote" })).toBeEnabled();

    await usuario.click(screen.getByRole("button", { name: "Producir y cerrar lote" }));
    const ventana = screen.getByRole("dialog", { name: "Producir y cerrar lote" });
    expect(ventana).toHaveTextContent("Queso paria: 100 L de la leche del 17/10/2026, al costo por litro útil de ese día.");
    expect(ventana).toHaveTextContent("Un lote cerrado no se altera.");
    await usuario.click(within(ventana).getByRole("button", { name: "Producir y cerrar lote" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(enviado.producidos).toEqual([{ receta_id: 1, fecha_leche: "2026-10-17", litros: 100, cantidad_producida: 10.5 }]);
    expect(screen.getByRole("status")).toHaveTextContent("Lote L-2026-0002 de Queso paria cerrado con 10.5 unidades.");
  });

  it("bloquea el botón mientras falte stock y dice qué reponer", async () => {
    simularProduccion({ ...PREVIA_OK, insumos: [
      { insumo_id: 1, nombre: "Cuajo líquido", unidad: "ml", necesita: 20, hay: 12.5, falta: 7.5 },
      { insumo_id: 3, nombre: "Sal", unidad: "kg", necesita: 1.5, hay: 50, falta: 0 },
    ] });
    renderizar("/produccion");
    const usuario = userEvent.setup();
    await llenar(usuario);
    await usuario.click(screen.getByRole("button", { name: "Ver qué se necesita" }));

    const fila = within(await screen.findByRole("table", { name: "Insumos del lote" })).getByText("Cuajo líquido").closest("tr")!;
    expect(within(fila).getByText("7.5 ml")).toHaveClass("negativo");
    expect(screen.getByRole("alert")).toHaveTextContent("Falta stock de Cuajo líquido: repóngalo antes de producir.");
    expect(screen.getByRole("button", { name: "Producir y cerrar lote" })).toBeDisabled();
  });

  it("bloquea si no alcanza la leche de la jornada", async () => {
    simularProduccion({ ...PREVIA_OK, leche_disponible: 80 });
    renderizar("/produccion");
    const usuario = userEvent.setup();
    await llenar(usuario);
    await usuario.click(screen.getByRole("button", { name: "Ver qué se necesita" }));

    expect(await screen.findByText(/No alcanza la leche aprobada de esa jornada: pidió 100 L/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Producir y cerrar lote" })).toBeDisabled();
  });

  it("cambiar un dato borra la tabla (no se produce con números viejos); valida antes de pedir", async () => {
    const enviado = simularProduccion();
    renderizar("/produccion");
    const usuario = userEvent.setup();
    await screen.findByLabelText("Receta");

    await usuario.click(screen.getByRole("button", { name: "Ver qué se necesita" }));
    expect(screen.getByLabelText("Receta")).toHaveAccessibleDescription("Elija la receta");
    expect(enviado.previas).toEqual([]);

    await llenar(usuario);
    await usuario.click(screen.getByRole("button", { name: "Ver qué se necesita" }));
    await screen.findByRole("table", { name: "Insumos del lote" });
    await usuario.type(screen.getByLabelText("Litros de leche"), "0");
    expect(screen.queryByRole("table", { name: "Insumos del lote" })).not.toBeInTheDocument();
  });

  it("muestra el total de leche disponible y preselecciona la jornada más antigua con leche", async () => {
    simularProduccion();
    servidor.use(http.get(`${API}/jornadas`, () => HttpResponse.json([
      jornada("2026-10-14", 0), jornada("2026-10-15", 120.5), jornada("2026-10-17", 250)])));
    renderizar("/produccion");

    expect(await screen.findByText(/Leche disponible \(últimos 30 días\):/)).toHaveTextContent(
      "Leche disponible (últimos 30 días): 370.5 L");
    await waitFor(() => expect(screen.getByLabelText("Leche de la jornada")).toHaveValue("2026-10-15"));
    expect(within(screen.getByLabelText("Leche de la jornada")).getAllByRole("option").map((o) => o.textContent))
      .toEqual(["Elija…", "15/10/2026: 120.5 L disponibles", "17/10/2026: 250 L disponibles"]);
  });

  it("propone la cantidad con el rendimiento teórico al cambiar litros o receta, con su unidad", async () => {
    simularProduccion();
    renderizar("/produccion");
    const usuario = userEvent.setup();

    await usuario.selectOptions(await screen.findByLabelText("Receta"), "Queso paria (unidades)");
    await usuario.type(screen.getByLabelText("Litros de leche"), "150");
    expect(screen.getByLabelText("Cantidad producida (unidades)")).toHaveValue("16.5");              // 150 ÷ 100 × 11
    expect(screen.getByLabelText("Cantidad producida (unidades)")).toHaveAccessibleDescription("Se esperan ≈ 16.5 unidades.");

    await usuario.selectOptions(screen.getByLabelText("Receta"), "Yogurt (kilos)");
    expect(screen.getByLabelText("Cantidad producida (kilos)")).toHaveValue("157.5");                // 150 ÷ 100 × 105
    expect(screen.getByLabelText("Cantidad producida (kilos)")).toHaveAccessibleDescription("Se esperan ≈ 157.5 kilos.");
  });

  it("si la cantidad se aleja más de un 20 % del teórico avisa, sin bloquear", async () => {
    simularProduccion();
    renderizar("/produccion");
    const usuario = userEvent.setup();
    await llenar(usuario, "100", "13");          // 11 esperadas: +18 %, no avisa
    expect(screen.queryByText(/muy distinta del rendimiento teórico/)).not.toBeInTheDocument();

    await usuario.clear(screen.getByLabelText(/^Cantidad producida/));
    await usuario.type(screen.getByLabelText(/^Cantidad producida/), "14");   // +27 %
    expect(screen.getByText(/muy distinta del rendimiento teórico de la receta \(≈ 11\)/)).toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Ver qué se necesita" }));
    expect(await screen.findByRole("button", { name: "Producir y cerrar lote" })).toBeEnabled();
  });

  it("el 409 de la base se muestra en la ventana", async () => {
    simularProduccion();
    servidor.use(http.post(`${API}/produccion`, () =>
      HttpResponse.json({ codigo: "conflicto", mensaje: "Stock insuficiente del insumo 1" }, { status: 409 })));
    renderizar("/produccion");
    const usuario = userEvent.setup();
    await llenar(usuario);
    await usuario.click(screen.getByRole("button", { name: "Ver qué se necesita" }));
    await usuario.click(await screen.findByRole("button", { name: "Producir y cerrar lote" }));
    await usuario.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Producir y cerrar lote" }));
    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent("Stock insuficiente del insumo 1");
  });
});

// ----------------------------------------------------------------- ventas
function disponible(cambios: Partial<LoteDisponible> = {}): LoteDisponible {
  return { lote_id: 1, codigo: "L-2026-0001", receta: "Queso paria", fecha_produccion: "2026-10-18", saldo: 11,
           fecha_vencimiento: "2026-11-17", dias_para_vencer: 30, vencido: false, por_vencer: false, unidad_venta: "unidad",
           precio_venta: 20, ...cambios };
}

function simularVentas() {
  const enviado = { ventas: [] as VentaRapida[], clientes: [] as ClienteNuevo[] };
  let clientes: Cliente[] = [{ id: 3, nombre: "Bodega Puno", tipo: "natural", documento: null, celular: null }];
  servidor.use(
    http.get(`${API}/clientes`, () => HttpResponse.json(clientes)),
    http.post(`${API}/clientes`, async ({ request }) => {
      const datos = (await request.json()) as ClienteNuevo;
      enviado.clientes.push(datos);
      const nuevo: Cliente = { id: 4, nombre: datos.nombre, tipo: datos.tipo, documento: datos.documento ?? null, celular: null };
      clientes = [...clientes, nuevo];
      return HttpResponse.json(nuevo, { status: 201 });
    }),
    http.get(`${API}/lotes/disponibles`, () => HttpResponse.json([
      disponible(), disponible({ lote_id: 2, codigo: "L-2026-0002", receta: "Yogurt", saldo: 50, unidad_venta: "kilo",
                                 precio_venta: 7, por_vencer: true }),
      disponible({ lote_id: 3, codigo: "L-2026-0003", vencido: true }),
    ])),
    http.get(`${API}/ventas`, () => HttpResponse.json([] as Venta[])),
    http.post(`${API}/ventas`, async ({ request }) => {
      const datos = (await request.json()) as VentaRapida;
      enviado.ventas.push(datos);
      return HttpResponse.json({ venta_id: 1, fecha: "2026-10-18", cliente_id: datos.cliente_id, cliente: "Bodega Puno",
                                 lote_id: datos.lote_id, codigo_lote: "L-2026-0001", receta: "Queso paria",
                                 cantidad: datos.cantidad, precio_unitario: datos.precio_unitario,
                                 subtotal: datos.cantidad * datos.precio_unitario } satisfies Venta, { status: 201 });
    }),
  );
  return enviado;
}

describe("ventas", () => {
  it("ofrece solo lotes no vencidos (con saldo y vencimiento) y avisa de los vencidos", async () => {
    simularVentas();
    renderizar("/ventas");
    await screen.findByLabelText("Lote");
    await waitFor(() => expect(within(screen.getByLabelText("Lote")).getAllByRole("option")).toHaveLength(3));
    expect(within(screen.getByLabelText("Lote")).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Elija…", "L-2026-0001 · Queso paria · saldo 11 unid. · vence 17/11/2026",
      "L-2026-0002 · Yogurt · saldo 50 kg · vence 17/11/2026 (por vencer)"]);
    expect(screen.getByText(/1 lote vencido tiene saldo y no se puede vender: L-2026-0003/)).toBeInTheDocument();
  });

  it("propone el precio de la receta, no deja pasar del saldo y confirma con el subtotal", async () => {
    const enviado = simularVentas();
    renderizar("/ventas");
    const usuario = userEvent.setup();
    await waitFor(() => expect(within(screen.getByLabelText("Lote")).getAllByRole("option")).toHaveLength(3));

    await usuario.selectOptions(screen.getByLabelText("Cliente"), "Bodega Puno");
    await usuario.selectOptions(screen.getByLabelText("Lote"), "L-2026-0001 · Queso paria · saldo 11 unid. · vence 17/11/2026");
    expect(screen.getByLabelText("Precio unitario (S/)")).toHaveValue("20");
    await usuario.type(screen.getByLabelText(/^Cantidad/), "12");
    await usuario.click(screen.getByRole("button", { name: "Registrar venta" }));
    expect(screen.getByLabelText(/^Cantidad/)).toHaveAccessibleDescription("No puede pasar del saldo del lote (11)");
    expect(enviado.ventas).toEqual([]);

    await usuario.clear(screen.getByLabelText(/^Cantidad/));
    await usuario.type(screen.getByLabelText(/^Cantidad/), "3");
    await usuario.clear(screen.getByLabelText("Precio unitario (S/)"));
    await usuario.type(screen.getByLabelText("Precio unitario (S/)"), "19.5");
    await usuario.click(screen.getByRole("button", { name: "Registrar venta" }));
    const ventana = screen.getByRole("dialog", { name: "Registrar venta" });
    expect(ventana).toHaveTextContent("Bodega Puno: 3 unid. del lote L-2026-0001 (Queso paria) a S/ 19.50: S/ 58.50, al contado");
    expect(ventana).toHaveTextContent("No se puede anular desde el panel.");
    await usuario.click(within(ventana).getByRole("button", { name: "Registrar venta" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(enviado.ventas).toEqual([{ cliente_id: 3, lote_id: 1, cantidad: 3, precio_unitario: 19.5 }]);
    expect(screen.getByRole("status")).toHaveTextContent("Venta de S/ 58.50 a Bodega Puno registrada.");
  });

  it("nuevo cliente: con RUC es empresa, y queda elegido", async () => {
    const enviado = simularVentas();
    renderizar("/ventas");
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole("button", { name: "Nuevo cliente" }));
    const ventana = screen.getByRole("dialog", { name: "Nuevo cliente" });
    await usuario.type(within(ventana).getByLabelText("Nombre o razón social"), " Lácteos SAC ");
    await usuario.type(within(ventana).getByLabelText("DNI o RUC (opcional)"), "20123456789");
    await usuario.click(within(ventana).getByRole("button", { name: "Guardar cliente" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(enviado.clientes).toEqual([{ nombre: "Lácteos SAC", tipo: "empresa", documento: "20123456789" }]);
    await waitFor(() => expect(screen.getByLabelText("Cliente")).toHaveValue("4"));
  });
});

describe("teorico", () => {
  it("litros ÷ litros_base × rendimiento_base, con 2 decimales; sin rendimiento o sin litros, null", () => {
    expect(teorico({ litros_base: 50, rendimiento_base: 6 }, 75)).toBe(9);          // otra base que 100 L
    expect(teorico({ litros_base: 100, rendimiento_base: 11 }, 33)).toBe(3.63);
    expect(teorico({ litros_base: 100, rendimiento_base: null }, 100)).toBeNull();
    expect(teorico({ litros_base: 100, rendimiento_base: 11 }, 0)).toBeNull();
  });
});
