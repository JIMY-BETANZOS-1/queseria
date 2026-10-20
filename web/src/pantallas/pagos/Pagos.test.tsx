import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AcopiadorMes, PagoAcopiadorCambios, PagoAcopiadorNuevo, RecoleccionDetalle } from "../../api/tipos";
import { respuestaLogin } from "../../pruebas/datos";
import { acopiadorMes, liquidacion, liquidacionDetalle, pagable, pagoPendiente, recoleccion } from "../../pruebas/fabricas";
import { irPorMenu } from "../../pruebas/menu";
import { renderizar, ubicacion } from "../../pruebas/renderizar";
import { API, servidor } from "../../pruebas/servidor";
import { guardarSesion } from "../../sesion/almacen";

beforeEach(() => {
  guardarSesion(respuestaLogin());
  // Domingo 18/10 a las 23:30 en Lima = 04:30 UTC del lunes 19 (y las pruebas corren en Tokio)
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 19, 4, 30));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const id = (n: number) => `0f6c2a4e-0000-4000-8000-${String(n).padStart(12, "0")}`;

// ----------------------------------------------------------------- liquidar periodo
describe("liquidar periodo", () => {
  /** Lo pagable del periodo y las entregas del periodo (paginadas de a 1000, como el backend). */
  function simularPrevia(entregas: RecoleccionDetalle[]) {
    const consultas: string[] = [];
    const lotes: unknown[] = [];
    servidor.use(
      http.get(`${API}/pagos/productores/periodo`, ({ request }) => {
        consultas.push(`periodo${new URL(request.url).search}`);
        return HttpResponse.json([pagable(), pagable({ productor_id: 121, codigo: "P-0121", nombre: "Pedro Quispe",
                                                       n_recolecciones: 1, litros: 30, monto: 21, litros_con_sancion: 30 })]);
      }),
      http.get(`${API}/recolecciones`, ({ request }) => {
        const url = new URL(request.url);
        consultas.push(`recolecciones${url.search}`);
        const offset = Number(url.searchParams.get("offset"));
        return HttpResponse.json(entregas.slice(offset, offset + 1000));
      }),
      http.post(`${API}/liquidaciones/lote`, async ({ request }) => {
        lotes.push(await request.json());
        return HttpResponse.json([liquidacion(), liquidacion({ liquidacion_id: 901, productor_id: 121 })], { status: 201 });
      }),
      http.get(`${API}/pagos/productores/pendientes`, () => HttpResponse.json([])),
      http.get(`${API}/liquidaciones`, () => HttpResponse.json([])),
    );
    return { consultas, lotes };
  }

  // 1000 entregas ya pagables (página 1) y, en la página 2: 2 sin revisar (una de un productor sin nada pagable),
  // 1 retenida, 1 anulada y 1 ya liquidada (estas dos no cuentan)
  const PAGINA_1 = Array.from({ length: 1000 }, (_, i) => recoleccion({ recoleccion_id: id(1000 + i), pagable: true }));
  const PAGINA_2 = [
    recoleccion({ recoleccion_id: id(1), revisada: false, pagable: false }),
    recoleccion({ recoleccion_id: id(2), revisada: false, pagable: false, productor_id: 130, productor: "Sin Pagables",
                  productor_codigo: "P-0130" }),
    recoleccion({ recoleccion_id: id(3), retenida: true, pagable: false, productor_id: 121, productor: "Pedro Quispe" }),
    recoleccion({ recoleccion_id: id(4), anulada_en: "2026-10-06T09:00:00-05:00", retenida: null, pagable: null, liquidada: null }),
    recoleccion({ recoleccion_id: id(5), liquidada: true, pagable: true }),
  ];

  it("por defecto propone la semana anterior de lunes a domingo en Lima", async () => {
    simularPrevia([]);
    renderizar("/pagos/liquidar");
    expect(await screen.findByLabelText("Desde")).toHaveValue("2026-10-05");
    expect(screen.getByLabelText("Hasta")).toHaveValue("2026-10-11");
  });

  it("valida que 'hasta' no sea anterior a 'desde' antes de pedir nada", async () => {
    const { consultas } = simularPrevia([]);
    renderizar("/pagos/liquidar?desde=2026-10-11&hasta=2026-10-05");
    await userEvent.setup().click(await screen.findByRole("button", { name: "Ver vista previa" }));

    expect(screen.getByLabelText("Hasta")).toHaveAccessibleDescription("No puede ser anterior a la fecha inicial");
    expect(consultas).toEqual([]);
  });

  it("vista previa: lo pagable por productor, las entregas en espera y la advertencia de otro periodo", async () => {
    const { consultas } = simularPrevia([...PAGINA_1, ...PAGINA_2]);
    renderizar("/pagos/liquidar");
    await userEvent.setup().click(await screen.findByRole("button", { name: "Ver vista previa" }));

    expect(await screen.findByRole("heading", { name: "Vista previa del 05/10/2026 al 11/10/2026" })).toBeInTheDocument();
    expect(consultas).toEqual([
      "periodo?desde=2026-10-05&hasta=2026-10-11",
      "recolecciones?desde=2026-10-05&hasta=2026-10-11&incluir_anuladas=true&limit=1000&offset=0",
      "recolecciones?desde=2026-10-05&hasta=2026-10-11&incluir_anuladas=true&limit=1000&offset=1000",
    ]);
    expect(screen.getByText(/3 entregas del periodo quedan en espera/)).toHaveTextContent(
      "3 entregas del periodo quedan en espera (sin revisar o retenidas) y no entran. Se pagarán en otro periodo: la base " +
      "no deja volver a liquidar este mismo periodo para el mismo productor.");

    const fila = (nombre: string) => within(screen.getByRole("link", { name: nombre }).closest("tr")!)
      .getAllByRole("cell").map((c) => c.textContent);
    expect(fila("Pedro Quispe")).toEqual(["Pedro Quispe (P-0121)", "1", "30 L", "30 L", "S/ 21.00", "1"]);
    expect(fila("Rosa Condori Huanca")).toEqual(["Rosa Condori Huanca (P-0120)", "2", "52.5 L", "0 L", "S/ 89.25", "1"]);
    expect(fila("Sin Pagables")).toEqual(["Sin Pagables (P-0130)", "0", "0 L", "0 L", "S/ 0.00", "1"]);
    expect(screen.getByRole("button", { name: "Crear 2 liquidaciones" })).toBeEnabled();
  });

  it("crear: confirma, envía el periodo y vuelve a Pagos con el aviso", async () => {
    const { lotes } = simularPrevia(PAGINA_2);
    renderizar("/pagos/liquidar");
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole("button", { name: "Ver vista previa" }));
    await usuario.click(await screen.findByRole("button", { name: "Crear 2 liquidaciones" }));

    const ventana = screen.getByRole("dialog", { name: "Crear liquidaciones" });
    expect(ventana).toHaveTextContent("por S/ 110.25 en total. Los montos quedan congelados.");
    expect(ventana).toHaveTextContent("Las entregas en espera no entran");
    await usuario.click(within(ventana).getByRole("button", { name: "Crear liquidaciones" }));

    await waitFor(() => expect(ubicacion()).toBe("/pagos/productores"));
    expect(lotes).toEqual([{ desde: "2026-10-05", hasta: "2026-10-11" }]);
    expect(screen.getByRole("status")).toHaveTextContent("Se crearon 2 liquidaciones.");
  });

  it("cambiar una fecha borra la vista previa (no se liquida otro periodo por error)", async () => {
    simularPrevia(PAGINA_2);
    renderizar("/pagos/liquidar");
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole("button", { name: "Ver vista previa" }));
    await screen.findByRole("button", { name: "Crear 2 liquidaciones" });

    await usuario.clear(screen.getByLabelText("Hasta"));
    await usuario.type(screen.getByLabelText("Hasta"), "2026-10-10");
    expect(screen.queryByRole("button", { name: /Crear/ })).not.toBeInTheDocument();
    expect(ubicacion()).toBe("/pagos/liquidar?desde=2026-10-05&hasta=2026-10-10");
  });
});

// ----------------------------------------------------------------- por pagar y liquidaciones
describe("pagos a productores", () => {
  it("el menú lleva a la pantalla: por pagar con totales y liquidaciones pendientes por defecto", async () => {
    const consultas: string[] = [];
    servidor.use(
      http.get(`${API}/pagos/productores/pendientes`, () => HttpResponse.json([
        pagoPendiente(), pagoPendiente({ productor_id: 121, nombre: "Pedro Quispe", codigo: "P-0121", monto_pagable: 30.5,
                                         monto_en_espera: 0 })])),
      http.get(`${API}/liquidaciones`, ({ request }) => {
        consultas.push(new URL(request.url).search);
        return HttpResponse.json([liquidacion(), liquidacion({ liquidacion_id: 901, estado: "pagado" })]);
      }),
    );
    renderizar("/");
    const usuario = userEvent.setup();
    await irPorMenu(usuario, "Dinero", "Pagos a productores");

    expect(await screen.findByText("S/ 200.50")).toBeInTheDocument();
    expect(screen.getByText(/S\/ 34.00 en espera/)).toBeInTheDocument();
    expect(consultas).toEqual(["?estado=pendiente"]);
    const seccion = screen.getByRole("heading", { name: "Liquidaciones" }).closest("section")!;
    expect(within(seccion).getAllByRole("link").map((a) => a.getAttribute("href")))
      .toEqual(["/pagos/liquidaciones/900", "/pagos/liquidaciones/901"]);
    expect(within(seccion).getByText("Pagada")).toBeInTheDocument();

    await usuario.selectOptions(screen.getByLabelText("Estado"), "Todas");
    await waitFor(() => expect(consultas.at(-1)).toBe(""));
    await usuario.selectOptions(screen.getByLabelText("Estado"), "Pagadas");
    await waitFor(() => expect(consultas.at(-1)).toBe("?estado=pagado"));
  });
});

describe("liquidación (comprobante)", () => {
  function simular(inicial = liquidacionDetalle()) {
    let actual = inicial;
    const llamadas: string[] = [];
    servidor.use(
      http.get(`${API}/liquidaciones/900`, () => HttpResponse.json(actual)),
      http.post(`${API}/liquidaciones/900/pagar`, () => {
        llamadas.push("pagar");
        actual = { ...actual, estado: "pagado", pagada_en: "2026-10-18T23:31:00-05:00" };
        return HttpResponse.json(actual);
      }),
      http.delete(`${API}/liquidaciones/900`, () => {
        llamadas.push("eliminar");
        return new HttpResponse(null, { status: 204 });
      }),
      http.get(`${API}/pagos/productores/pendientes`, () => HttpResponse.json([])),
      http.get(`${API}/liquidaciones`, () => HttpResponse.json([])),
    );
    return llamadas;
  }

  it("muestra cada entrega con su precio congelado, el total y el descuento por sanción; se imprime", async () => {
    simular();
    const imprimir = vi.spyOn(window, "print").mockImplementation(() => {});
    renderizar("/pagos/liquidaciones/900");

    expect(await screen.findByRole("heading", { name: /Liquidación de Rosa Condori Huanca/ })).toBeInTheDocument();
    expect(screen.getByText("Periodo del 05/10/2026 al 11/10/2026")).toBeInTheDocument();
    expect(screen.getByText(/^Estado:/).closest("p")).toHaveTextContent("Estado: PENDIENTE DE PAGO");
    expect(screen.getByText(/^Estado:/).closest("p")).not.toHaveClass("no-imprimir");   // también sale al imprimir
    const filas = screen.getAllByRole("row").slice(1).map((f) => within(f).getAllByRole("cell").map((c) => c.textContent));
    expect(filas).toEqual([
      ["06/10/2026 06:15", "42.5 L", "S/ 1.70", "", "S/ 72.25"],
      ["09/10/2026 06:20", "10 L", "S/ 0.70", "Sí", "S/ 7.00"],
      ["Total (2 entregas)", "52.5 L", "", "", "S/ 79.25"],
    ]);
    expect(screen.getByText("10 L con precio de sanción: descuento de S/ 10.00 frente al precio normal.")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Imprimir comprobante" }));
    expect(imprimir).toHaveBeenCalledOnce();
  });

  it("marcar pagada: confirma que ya no se podrá cambiar y deja de ofrecer acciones", async () => {
    const llamadas = simular();
    renderizar("/pagos/liquidaciones/900");
    const usuario = userEvent.setup();

    await usuario.click(await screen.findByRole("button", { name: "Marcar pagada" }));
    const ventana = screen.getByRole("dialog", { name: "Marcar liquidación pagada" });
    expect(ventana).toHaveTextContent("Queda pagada por S/ 79.25, con la fecha y hora de ahora y a su nombre.");
    expect(ventana).toHaveTextContent("ya no se puede modificar ni eliminar");
    await usuario.click(within(ventana).getByRole("button", { name: "Marcar pagada" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(llamadas).toEqual(["pagar"]);
    expect(screen.getByText("Pagada")).toBeInTheDocument();
    expect(screen.getByText(/^Estado:/).closest("p")).toHaveTextContent("Estado: PAGADA el 18/10/2026 23:31");
    expect(screen.queryByRole("button", { name: "Marcar pagada" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Eliminar" })).not.toBeInTheDocument();
  });

  it("eliminar una pendiente: avisa que sus entregas vuelven a por pagar y vuelve a Pagos", async () => {
    const llamadas = simular();
    renderizar("/pagos/liquidaciones/900");
    const usuario = userEvent.setup();

    await usuario.click(await screen.findByRole("button", { name: "Eliminar" }));
    const ventana = screen.getByRole("dialog", { name: "Eliminar liquidación" });
    expect(ventana).toHaveTextContent("Sus 2 entregas vuelven a \"por pagar\".");
    await usuario.click(within(ventana).getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(ubicacion()).toBe("/pagos/productores"));
    expect(llamadas).toEqual(["eliminar"]);
  });

  it("el 409 de la base se muestra en la ventana", async () => {
    simular();
    servidor.use(http.post(`${API}/liquidaciones/900/pagar`, () =>
      HttpResponse.json({ codigo: "conflicto", mensaje: "No se puede pagar una liquidación sin detalle" }, { status: 409 })));
    renderizar("/pagos/liquidaciones/900");
    const usuario = userEvent.setup();

    await usuario.click(await screen.findByRole("button", { name: "Marcar pagada" }));
    await usuario.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Marcar pagada" }));
    expect(await within(screen.getByRole("dialog")).findByRole("alert"))
      .toHaveTextContent("No se puede pagar una liquidación sin detalle");
  });
});

// ----------------------------------------------------------------- acopiadores
describe("pagos a acopiadores", () => {
  function simular(filas: AcopiadorMes[]) {
    let actuales = filas;
    const enviado = { consultas: [] as string[], nuevos: [] as PagoAcopiadorNuevo[], cambios: [] as PagoAcopiadorCambios[],
                      pagados: [] as number[], eliminados: [] as number[] };
    servidor.use(
      http.get(`${API}/pagos/acopiadores`, ({ request }) => {
        enviado.consultas.push(new URL(request.url).search);
        return HttpResponse.json(actuales);
      }),
      http.post(`${API}/pagos/acopiadores`, async ({ request }) => {
        const datos = (await request.json()) as PagoAcopiadorNuevo;
        enviado.nuevos.push(datos);
        actuales = actuales.map((a) => (a.acopiador_id === datos.acopiador_id
          ? { ...a, pago_id: 50, estado: "pendiente", pago_sueldo_base: a.sueldo_base_mensual, pago_comision: a.comision_estimada,
              ajustes: datos.ajustes ?? 0, total: a.sueldo_estimado + (datos.ajustes ?? 0), nota: datos.nota ?? null }
          : a));
        return HttpResponse.json({ id: 50 }, { status: 201 });
      }),
      http.patch(`${API}/pagos/acopiadores/50`, async ({ request }) => {
        enviado.cambios.push((await request.json()) as PagoAcopiadorCambios);
        return HttpResponse.json({ id: 50 });
      }),
      http.post(`${API}/pagos/acopiadores/50/pagar`, () => {
        enviado.pagados.push(50);
        actuales = actuales.map((a) => (a.pago_id === 50 ? { ...a, estado: "pagado", pagado_en: "2026-10-18T23:40:00-05:00" } : a));
        return HttpResponse.json({ id: 50 });
      }),
      http.delete(`${API}/pagos/acopiadores/50`, () => {
        enviado.eliminados.push(50);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    return enviado;
  }

  const fila = (nombre: string) => screen.getByText(nombre).closest("tr")!;

  it("el menú lleva a la pantalla: mes actual en Lima, estimado y sin registrar", async () => {
    const enviado = simular([acopiadorMes()]);
    renderizar("/");
    await irPorMenu(userEvent.setup(), "Dinero", "Sueldos de acopiadores");

    expect(await screen.findByText("Juan Carlos Mamani Quispe")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Sueldos de acopiadores");
    await waitFor(() => expect(document.title).toBe("Sueldos de acopiadores · Quesería Huata"));
    expect(enviado.consultas).toEqual(["?mes=2026-10-01"]);
    expect(screen.getByLabelText("Mes")).toHaveValue("2026-10");
    const celdas = within(fila("Juan Carlos Mamani Quispe")).getAllByRole("cell").map((c) => c.textContent);
    expect(celdas.slice(1, 7)).toEqual(["60", "1,150 L", "S/ 900.00", "S/ 57.50", "S/ 957.50", "Sin registrar"]);
  });

  it("cambiar de mes pide ese mes", async () => {
    const enviado = simular([acopiadorMes()]);
    renderizar("/pagos/acopiadores?mes=2026-09");
    await screen.findByText("Juan Carlos Mamani Quispe");
    expect(enviado.consultas).toEqual(["?mes=2026-09-01"]);
  });

  it("registrar: valida ajustes, envía acopiador, mes, ajustes y nota, y queda pendiente", async () => {
    const enviado = simular([acopiadorMes()]);
    renderizar("/pagos/acopiadores");
    const usuario = userEvent.setup();

    await usuario.click(within(fila(await screen.findByText("Juan Carlos Mamani Quispe").then((e) => e.textContent!)))
      .getByRole("button", { name: "Registrar pago" }));
    const ventana = screen.getByRole("dialog", { name: "Registrar pago del mes" });
    expect(ventana).toHaveTextContent("Sueldo base S/ 900.00 + comisión S/ 57.50 (lo estimado ahora).");
    expect(ventana).toHaveTextContent("Se guardan los litros, el sueldo base y la comisión de este momento.");

    const ajustes = within(ventana).getByLabelText("Ajustes (S/)");
    await usuario.clear(ajustes);
    await usuario.type(ajustes, "abc");
    await usuario.click(within(ventana).getByRole("button", { name: "Guardar" }));
    expect(ajustes).toHaveAccessibleDescription(/^Monto en soles/);
    expect(enviado.nuevos).toEqual([]);

    await usuario.clear(ajustes);
    await usuario.type(ajustes, "-20.5");
    await usuario.type(within(ventana).getByLabelText("Nota (opcional)"), " Faltó un día ");
    expect(ventana).toHaveTextContent("Total: S/ 937.00");
    await usuario.click(within(ventana).getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(enviado.nuevos).toEqual([{ acopiador_id: 7, mes: "2026-10-01", ajustes: -20.5, nota: "Faltó un día" }]);
    expect(screen.getByRole("status")).toHaveTextContent("Pago registrado: queda pendiente.");
    expect(await within(fila("Juan Carlos Mamani Quispe")).findByText("Pendiente")).toBeInTheDocument();
  });

  const PENDIENTE = acopiadorMes({ pago_id: 50, estado: "pendiente", pago_sueldo_base: 900, pago_comision: 57.5, ajustes: 0,
                                   total: 957.5 });

  it("marcar pagado: avisa el gasto y su monto, y el pago queda cerrado", async () => {
    const enviado = simular([PENDIENTE]);
    renderizar("/pagos/acopiadores");
    const usuario = userEvent.setup();
    await screen.findByText("Juan Carlos Mamani Quispe");

    await usuario.click(screen.getByRole("button", { name: "Marcar pagado" }));
    const ventana = screen.getByRole("dialog", { name: "Marcar pago como pagado" });
    expect(ventana).toHaveTextContent("Se registra el gasto \"Sueldo acopiador\" por S/ 957.50 con la fecha de hoy.");
    expect(ventana).toHaveTextContent("ya no se puede editar ni eliminar");
    await usuario.click(within(ventana).getByRole("button", { name: "Marcar pagado" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(enviado.pagados).toEqual([50]);
    expect(await within(fila("Juan Carlos Mamani Quispe")).findByText("Pagado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
  });

  it("total cero: el 409 de la base se muestra en la ventana", async () => {
    simular([PENDIENTE]);
    servidor.use(http.post(`${API}/pagos/acopiadores/50/pagar`, () =>
      HttpResponse.json({ codigo: "conflicto", mensaje: "El monto del gasto debe ser mayor que cero" }, { status: 409 })));
    renderizar("/pagos/acopiadores");
    const usuario = userEvent.setup();
    await screen.findByText("Juan Carlos Mamani Quispe");

    await usuario.click(screen.getByRole("button", { name: "Marcar pagado" }));
    await usuario.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Marcar pagado" }));
    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent("El monto del gasto debe ser mayor que cero");
  });

  it("editar envía ajustes y nota; eliminar un pendiente", async () => {
    const enviado = simular([{ ...PENDIENTE, ajustes: 10, nota: "Bono" }]);
    renderizar("/pagos/acopiadores");
    const usuario = userEvent.setup();
    await screen.findByText("Juan Carlos Mamani Quispe");

    await usuario.click(screen.getByRole("button", { name: "Editar" }));
    const ventana = screen.getByRole("dialog", { name: "Editar pago" });
    expect(within(ventana).getByLabelText("Ajustes (S/)")).toHaveValue("10");
    await usuario.clear(within(ventana).getByLabelText("Nota (opcional)"));
    await usuario.click(within(ventana).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(enviado.cambios).toEqual([{ ajustes: 10, nota: null }]);

    await usuario.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(screen.getByRole("dialog", { name: "Eliminar pago pendiente" })).toHaveTextContent("No se registró ningún gasto.");
    await usuario.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(enviado.eliminados).toEqual([50]));
  });
});
