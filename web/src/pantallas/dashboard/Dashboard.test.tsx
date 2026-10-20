import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dashboard, Jornada } from "../../api/tipos";
import { respuestaLogin } from "../../pruebas/datos";
import { renderizar, ubicacion } from "../../pruebas/renderizar";
import { API, servidor } from "../../pruebas/servidor";
import { guardarSesion } from "../../sesion/almacen";
import { diasDelGrafico } from "./GraficoLeche";

beforeEach(() => {
  guardarSesion(respuestaLogin());
  // 23:30 del domingo 18/10 en Lima = 04:30 UTC del 19/10 (y las pruebas corren en Tokio): hoy es el 18
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 19, 4, 30));
});

afterEach(() => {
  vi.useRealTimers();
});

function dashboard(cambios: Partial<Dashboard> = {}): Dashboard {
  return {
    mes: "2026-10-01",
    leche: { litros_recolectados: 5230.5, litros_aprobados: 4800, litros_por_revisar: 380.5, litros_descartados: 50, costo_pagado: 8160 },
    flujo: { ingresos: 0, egreso_leche: 8100, egreso_insumos: 350, egreso_lotes: 0, egreso_operativo: 957.5, total_invertido: 9407.5,
             saldo_caja: -9407.5 },
    resultado: { ingresos: 0, costo_ventas: 0, perdida_producto: 0, perdida_leche: 85, gasto_operativo: 957.5, utilidad_neta: -1042.5 },
    por_pagar: { monto_pagable: 1200.5, monto_en_espera: 340, liquidaciones_pendientes: 3, monto_liquidaciones_pendientes: 980 },
    acopiadores: { sueldo_estimado: 1915, pagado: 957.5, pagos_pendientes: 1 },
    atencion: { alertas_pendientes: 4, alertas_que_retienen: 1, altas_por_aprobar: 2, entregas_sin_revisar: 12, productores_observados: 3 },
    ...cambios,
  };
}

function jornada(fecha: string, aprobados: number, porRevisar = 0, descartados = 0): Jornada {
  return { fecha, litros_recolectados: aprobados + porRevisar + descartados, litros_aprobados: aprobados,
           litros_por_revisar: porRevisar, litros_descartados: descartados, litros_usados: 0, litros_merma: 0,
           litros_disponibles: aprobados, costo_pagado: 0, costo_litro_util: null, dias_antiguedad: 0, sin_destino: false };
}

function simular(datos = dashboard(), dias: Jornada[] = [jornada("2026-10-05", 300), jornada("2026-10-18", 200, 80, 20)]) {
  const consultas: string[] = [];
  servidor.use(
    http.get(`${API}/dashboard`, ({ request }) => {
      consultas.push(`dashboard${new URL(request.url).search}`);
      return HttpResponse.json(datos);
    }),
    http.get(`${API}/jornadas`, ({ request }) => {
      consultas.push(`jornadas${new URL(request.url).search}`);
      return HttpResponse.json(dias);
    }),
  );
  return consultas;
}

function tarjeta(titulo: string): HTMLElement {
  return screen.getByText(titulo, { selector: ".tarjeta-dato > span" }).closest(".tarjeta-dato") as HTMLElement;
}

describe("dashboard", () => {
  it("es la pantalla de inicio (/): mes actual en Lima y los últimos 14 días", async () => {
    const consultas = simular();
    renderizar("/");

    expect(ubicacion()).toBe("/");
    expect(await screen.findByRole("heading", { name: "Leche de octubre de 2026" })).toBeInTheDocument();
    expect(screen.getByLabelText("Mes")).toHaveValue("2026-10");
    expect(consultas.sort()).toEqual(["dashboard?mes=2026-10-01", "jornadas?desde=2026-10-05&hasta=2026-10-18"]);
    await waitFor(() => expect(document.title).toBe("Dashboard · Quesería Huata"));
  });

  it("requiere atención: cifras, enlaces y marca de atención cuando hay algo", async () => {
    simular();
    renderizar("/");
    await screen.findByText("Requiere atención");

    expect(tarjeta("Alertas sin revisar")).toHaveTextContent("41 retiene el pago · Ver alertas");
    expect(tarjeta("Alertas sin revisar")).toHaveClass("atencion");
    expect(within(tarjeta("Alertas sin revisar")).getByRole("link")).toHaveAttribute("href", "/alertas");
    expect(within(tarjeta("Entregas sin revisar (calidad)")).getByRole("link", { name: "Revisar" })).toHaveAttribute("href", "/calidad");
    expect(tarjeta("Altas de campo por aprobar")).toHaveTextContent("2");
    expect(tarjeta("Liquidaciones por pagar")).toHaveTextContent("3S/ 980.00 · Ver pagos");
    expect(tarjeta("Productores sancionados o bloqueados")).not.toHaveClass("atencion");
  });

  it("sin nada pendiente no marca atención", async () => {
    simular(dashboard({ atencion: { alertas_pendientes: 0, alertas_que_retienen: 0, altas_por_aprobar: 0, entregas_sin_revisar: 0,
                                    productores_observados: 0 } }));
    renderizar("/");
    await screen.findByText("Requiere atención");
    expect(document.querySelectorAll(".tarjeta-dato.atencion")).toHaveLength(0);
  });

  it("leche y dinero del mes, con la nota de que ventas y lotes son de la próxima fase", async () => {
    simular();
    renderizar("/");
    await screen.findByText("Requiere atención");

    expect(tarjeta("Recolectada")).toHaveTextContent("5,230.5 L");
    expect(tarjeta("Por revisar")).toHaveTextContent("380.5 L");
    expect(tarjeta("Por pagar a productores (acumulado a hoy)")).toHaveTextContent("S/ 1,200.50S/ 340.00 en espera");
    expect(tarjeta("Sueldos estimados de acopiadores")).toHaveTextContent("S/ 1,915.00S/ 957.50 pagado · 1 pago pendiente");
    expect(tarjeta("Flujo de caja del mes")).toHaveTextContent("−S/ 9,407.50");
    expect(within(tarjeta("Flujo de caja del mes")).getByText("−S/ 9,407.50")).toHaveClass("negativo");
    expect(within(tarjeta("Resultado (utilidad neta)")).getByText("−S/ 1,042.50")).toHaveClass("negativo");
    expect(within(tarjeta("Recolectada")).getByText("5,230.5 L")).not.toHaveClass("negativo");
    expect(tarjeta("Resultado (utilidad neta)")).toHaveTextContent(
      "pérdidas de producto S/ 0.00 − pérdidas de leche S/ 85.00 (incluye leche aún sin revisar) − gastos S/ 957.50");
    expect(tarjeta("Resultado (utilidad neta)")).toHaveTextContent(
      "La base cuenta como pérdida lo pagado en los días sin ninguna leche aprobada: un día con leche aún sin revisar " +
      "entra ahí hasta que se revise.");
    expect(screen.getByText(/Ventas y lotes todavía no se registran desde el panel/)).toBeInTheDocument();
  });

  it("sin leche por revisar en el mes, las pérdidas de leche no llevan la aclaración", async () => {
    simular(dashboard({ leche: { litros_recolectados: 100, litros_aprobados: 100, litros_por_revisar: 0, litros_descartados: 0,
                                 costo_pagado: 170 } }));
    renderizar("/");
    await screen.findByText("Requiere atención");
    expect(tarjeta("Resultado (utilidad neta)")).toHaveTextContent("pérdidas de leche S/ 85.00 − gastos");
    expect(tarjeta("Resultado (utilidad neta)")).not.toHaveTextContent("sin revisar");
  });

  it("cambiar de mes pide ese mes (y el gráfico sigue en los últimos 14 días)", async () => {
    const consultas = simular();
    renderizar("/?mes=2026-09");
    await screen.findByText("Requiere atención");
    expect(consultas).toContain("dashboard?mes=2026-09-01");
    expect(consultas).toContain("jornadas?desde=2026-10-05&hasta=2026-10-18");
  });

  it("el gráfico: 14 días con los vacíos en cero, barras apiladas sin style y la tabla con los mismos datos", async () => {
    simular();
    renderizar("/");
    const grafico = await screen.findByRole("img", { name: /Litros por día del 05\/10\/2026 al 18\/10\/2026: 600 L en total/ });
    expect(grafico.querySelectorAll("g")).toHaveLength(14);
    expect(grafico.querySelector("[style]")).toBeNull();
    // El día con más leche (18/10: 300 L = 200 + 80 + 20) llega al alto útil; las tres barras suman eso
    const ultimo = grafico.querySelectorAll("g")[13]!;
    const alturas = [...ultimo.querySelectorAll("rect")].map((r) => Number(r.getAttribute("height")));
    expect(alturas.reduce((a, b) => a + b, 0)).toBeCloseTo(138);
    expect(alturas[0]! / alturas[1]!).toBeCloseTo(200 / 80);
    // Apiladas: cada tramo empieza donde termina el de abajo
    const ys = [...ultimo.querySelectorAll("rect")].map((r) => Number(r.getAttribute("y")));
    expect(ys[1]! + alturas[1]!).toBeCloseTo(ys[0]!);
    expect(ys[2]! + alturas[2]!).toBeCloseTo(ys[1]!);

    const tabla = screen.getByRole("table", { name: "Litros por día" });
    const filas = within(tabla).getAllByRole("row").slice(1);
    expect(filas).toHaveLength(14);
    expect(filas[1]).toHaveTextContent("06/10/20260 L0 L0 L0 L");
    expect(filas[13]).toHaveTextContent("18/10/2026300 L200 L80 L20 L");
  });

  it("si la API falla, permite reintentar", async () => {
    let fallar = true;
    servidor.use(
      http.get(`${API}/dashboard`, () => (fallar
        ? HttpResponse.json({ codigo: "error_interno", mensaje: "Error interno del servidor" }, { status: 500 })
        : HttpResponse.json(dashboard()))),
      http.get(`${API}/jornadas`, () => HttpResponse.json([])),
    );
    renderizar("/");
    expect(await screen.findByRole("alert")).toHaveTextContent("Error interno del servidor");
    fallar = false;
    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Requiere atención")).toBeInTheDocument();
  });
});

describe("diasDelGrafico", () => {
  it("rellena con ceros los días sin fila y respeta el orden", () => {
    const dias = diasDelGrafico("2026-10-30", 3, [jornada("2026-11-01", 10)]);
    expect(dias.map((d) => [d.fecha, d.total])).toEqual([["2026-10-30", 0], ["2026-10-31", 0], ["2026-11-01", 10]]);
  });
});
