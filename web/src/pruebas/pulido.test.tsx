// Pulido para la demo: lo que no se ve en las pruebas de cada pantalla. jsdom no aplica estilos.css, así que las
// reglas visuales se comprueban leyendo el archivo; el resto, en la pantalla.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { respuestaLogin } from "./datos";
import { alerta, liquidacionDetalle, productorResumen, recoleccion } from "./fabricas";
import { renderizar } from "./renderizar";
import { API, servidor } from "./servidor";
import { guardarSesion } from "../sesion/almacen";

// Vitest corre desde web/ (en jsdom, import.meta.url no es una ruta de archivo)
const CSS = readFileSync(resolve(process.cwd(), "src/estilos.css"), "utf8");

/** El bloque de una regla de estilos.css, sin espacios de más. */
function regla(selector: string): string {
  const i = CSS.indexOf(`${selector} {`);
  return i < 0 ? "" : CSS.slice(i, CSS.indexOf("}", i)).replace(/\s+/g, " ");
}

beforeEach(() => {
  guardarSesion(respuestaLogin());
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 19, 4, 30));   // 23:30 del 18/10 en Lima
});

afterEach(() => {
  vi.useRealTimers();
});

describe("reglas de estilos.css", () => {
  it("los <p> de una ventana no suman su margen al espacio de .modal-cuerpo", () => {
    expect(regla(".modal-cuerpo > p")).toContain("margin: 0;");
  });

  it("un código de productor no se parte y lo negativo va en rojo", () => {
    expect(regla(".codigo")).toContain("white-space: nowrap;");
    expect(regla(".negativo")).toContain("color: var(--error-texto);");
  });

  it("el encabezado del comprobante solo sale al imprimir; el pie y el menú no se imprimen", () => {
    expect(regla(".solo-imprimir")).toContain("display: none;");
    const impresion = CSS.slice(CSS.indexOf("@media print"));
    expect(impresion).toMatch(/\.solo-imprimir \{\s*display: block;/);
    expect(impresion).toMatch(/\.pie,/);
  });
});

describe("códigos de productor sin partirse", () => {
  it("en Alertas, el '(P-0120)' va en .codigo", async () => {
    servidor.use(http.get(`${API}/alertas`, () => HttpResponse.json([alerta()])));
    renderizar("/alertas");
    expect(await screen.findByText("(P-0120)")).toHaveClass("codigo");
  });

  it("en Recolecciones del día, también", async () => {
    servidor.use(http.get(`${API}/recolecciones`, () => HttpResponse.json([recoleccion()])));
    renderizar("/recolecciones");
    expect(await screen.findByText("(P-0120)")).toHaveClass("codigo");
  });

  it("en la lista de productores, la celda del código", async () => {
    servidor.use(
      http.get(`${API}/productores`, () => HttpResponse.json([productorResumen()])),
      http.get(`${API}/rutas`, () => HttpResponse.json([])),
    );
    renderizar("/productores");
    expect(await screen.findByText("P-0120")).toHaveClass("codigo");
  });
});

describe("comprobante impreso", () => {
  it("lleva el nombre de la empresa (Configuración) y la fecha y hora de emisión en Lima", async () => {
    servidor.use(http.get(`${API}/liquidaciones/900`, () => HttpResponse.json(liquidacionDetalle())));
    renderizar("/pagos/liquidaciones/900");

    const encabezado = (await screen.findByText(/Comprobante de liquidación · emitido el/)).closest(".solo-imprimir")!;
    expect(encabezado).toHaveTextContent("Quesería Huata");
    expect(encabezado).toHaveTextContent("Comprobante de liquidación · emitido el 18/10/2026 23:30");
  });

  it("sin la configuración, sale igual sin el nombre de la empresa", async () => {
    servidor.use(
      http.get(`${API}/liquidaciones/900`, () => HttpResponse.json(liquidacionDetalle())),
      http.get(`${API}/configuracion`, () => HttpResponse.json({ codigo: "error_interno", mensaje: "Error" }, { status: 500 })),
    );
    renderizar("/pagos/liquidaciones/900");
    const encabezado = (await screen.findByText(/Comprobante de liquidación/)).closest(".solo-imprimir")!;
    expect(encabezado).not.toHaveTextContent("Quesería Huata");
  });

  it("con una sola entrega, todo en singular", async () => {
    const una = liquidacionDetalle({ n_recolecciones: 1, litros: 42.5, monto: 72.25, litros_con_sancion: 0, descuento_sancion: 0 });
    servidor.use(http.get(`${API}/liquidaciones/900`, () => HttpResponse.json({ ...una, lineas: una.lineas.slice(0, 1) })));
    renderizar("/pagos/liquidaciones/900");

    expect(await screen.findByText("Total (1 entrega)")).toBeInTheDocument();
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.setup().click(screen.getByRole("button", { name: "Eliminar" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Su entrega vuelve a \"por pagar\".");
  });
});

describe("plurales", () => {
  it("Alertas: 1 retiene el pago", async () => {
    servidor.use(http.get(`${API}/alertas`, () => HttpResponse.json([
      alerta({ id: 1, tipo: "firma_invalida" }), alerta({ id: 2 })])));
    renderizar("/alertas");
    expect(await screen.findByText(/1 retiene el pago/)).toBeInTheDocument();
    expect(screen.queryByText(/1 retienen/)).not.toBeInTheDocument();
  });

  it("Resumen: 1 retiene el pago y 1 pago pendiente", async () => {
    const { DASHBOARD_VACIO } = await import("./servidor");
    servidor.use(http.get(`${API}/dashboard`, () => HttpResponse.json({
      ...DASHBOARD_VACIO,
      atencion: { ...DASHBOARD_VACIO.atencion, alertas_pendientes: 3, alertas_que_retienen: 1 },
      acopiadores: { ...DASHBOARD_VACIO.acopiadores, pagos_pendientes: 1 },
    })));
    renderizar("/resumen");
    const alertas = (await screen.findByText("Alertas sin revisar", { selector: ".tarjeta-dato > span" })).closest(".tarjeta-dato")!;
    expect(alertas).toHaveTextContent("1 retiene el pago");
    expect(within(screen.getByText("Sueldos estimados de acopiadores", { selector: ".tarjeta-dato > span" }).closest(".tarjeta-dato")!)
      .getByText(/1 pago pendiente$/)).toBeInTheDocument();
  });
});
