import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dashboard, Jornada, LoteDisponible } from "../../api/tipos";
import { respuestaLogin } from "../../pruebas/datos";
import { renderizar } from "../../pruebas/renderizar";
import { API, DASHBOARD_VACIO, servidor } from "../../pruebas/servidor";
import { guardarSesion } from "../../sesion/almacen";

beforeEach(() => {
  guardarSesion(respuestaLogin());
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 19, 4, 30));   // 23:30 del 18/10 en Lima
});

afterEach(() => {
  vi.useRealTimers();
});

function jornada(fecha: string, recolectados: number, disponibles: number): Jornada {
  return { fecha, litros_recolectados: recolectados, litros_descartados: 0, litros_por_revisar: 0, litros_aprobados: recolectados,
           litros_usados: 0, litros_merma: 0, litros_disponibles: disponibles, costo_pagado: 0, costo_litro_util: 1.7,
           dias_antiguedad: 0, sin_destino: false };
}

function lote(lote_id: number): LoteDisponible {
  return { lote_id, codigo: `L-2026-000${lote_id}`, receta: "Queso paria", fecha_produccion: "2026-10-10", saldo: 3,
           fecha_vencimiento: null, dias_para_vencer: null, vencido: false, por_vencer: false, unidad_venta: "unidad",
           precio_venta: 20 };
}

const RESUMEN: Dashboard = {
  ...DASHBOARD_VACIO,
  por_pagar: { ...DASHBOARD_VACIO.por_pagar, monto_pagable: 1234.5 },
  atencion: { ...DASHBOARD_VACIO.atencion, alertas_pendientes: 2, alertas_que_retienen: 1, entregas_sin_revisar: 3, altas_por_aprobar: 1 },
};

function simular(resumen: Dashboard = RESUMEN) {
  const consultas: string[] = [];
  servidor.use(
    http.get(`${API}/dashboard`, ({ request }) => { consultas.push(`dashboard${new URL(request.url).search}`); return HttpResponse.json(resumen); }),
    http.get(`${API}/jornadas`, ({ request }) => {
      consultas.push(`jornadas${new URL(request.url).search}`);
      return HttpResponse.json([jornada("2026-10-15", 200, 20), jornada("2026-10-18", 120.5, 40.25)]);
    }),
    http.get(`${API}/lotes/disponibles`, () => HttpResponse.json([lote(1), lote(2)])),
  );
  return consultas;
}

const tarjeta = (titulo: string) => screen.getByRole("link", { name: new RegExp(`^${titulo}`) });

describe("inicio", () => {
  it("cuatro tarjetas con su cifra, cada una lleva a su pantalla", async () => {
    const consultas = simular();
    renderizar("/");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Inicio");
    const lista = screen.getByRole("list", { name: "Tareas del día" });
    expect(within(lista).getAllByRole("link").map((l) => l.querySelector(".tarjeta-accion-titulo")?.textContent))
      .toEqual(["Recibir leche", "Producir", "Vender", "Pagar"]);

    await waitFor(() => expect(tarjeta("Pagar")).toHaveTextContent("PagarS/ 1,234.50pagable a productores"));
    expect(tarjeta("Recibir leche")).toHaveTextContent("Recibir leche120.5 Lhoy · 3 entregas sin revisar");
    expect(tarjeta("Recibir leche")).toHaveAttribute("href", "/recolecciones");
    expect(tarjeta("Producir")).toHaveTextContent("Producir60.25 Lde leche aprobada disponible (últimos 30 días)");
    expect(tarjeta("Producir")).toHaveAttribute("href", "/produccion");
    expect(tarjeta("Vender")).toHaveTextContent("Vender2 lotescon saldo para vender");
    expect(tarjeta("Vender")).toHaveAttribute("href", "/ventas");
    expect(tarjeta("Pagar")).toHaveAttribute("href", "/pagos/productores");
    for (const l of within(lista).getAllByRole("link")) expect(l.querySelector("svg.icono")).toHaveAttribute("aria-hidden", "true");
    expect(consultas.sort()).toEqual(["dashboard?mes=2026-10-01", "jornadas?desde=2026-09-19&hasta=2026-10-18"]);
    await waitFor(() => expect(document.title).toBe("Inicio · Quesería Huata"));
  });

  it("requiere atención: etiquetas de color que llevan a su pantalla, o 'Nada pendiente'", async () => {
    simular();
    renderizar("/");
    const alertas = await screen.findByRole("link", { name: "2 alertas sin revisar" });
    expect(alertas).toHaveAttribute("href", "/alertas");
    expect(alertas.querySelector(".insignia")).toHaveClass("insignia-error");   // alguna retiene el pago
    expect(screen.getByRole("link", { name: "3 entregas por revisar calidad" })).toHaveAttribute("href", "/calidad");
    expect(screen.getByRole("link", { name: "1 alta de campo por aprobar" })).toHaveAttribute("href", "/productores");
    expect(screen.getByRole("link", { name: "Ver el resumen del mes" })).toHaveAttribute("href", "/resumen");
  });

  it("sin nada pendiente lo dice; sin entrega hoy, 0 L", async () => {
    simular(DASHBOARD_VACIO);
    servidor.use(http.get(`${API}/jornadas`, () => HttpResponse.json([jornada("2026-10-15", 200, 0)])));
    renderizar("/");
    expect(await screen.findByText("Nada pendiente")).toHaveClass("insignia-ok");
    await waitFor(() => expect(tarjeta("Recibir leche")).toHaveTextContent("0 Lhoy · 0 entregas sin revisar"));
    expect(tarjeta("Producir")).toHaveTextContent("Producir0 L");
  });

  it("si una carga falla, su tarjeta muestra — y sigue llevando a su pantalla", async () => {
    simular();
    servidor.use(
      http.get(`${API}/lotes/disponibles`, () => HttpResponse.json({ codigo: "error_interno", mensaje: "Error" }, { status: 500 })),
      http.get(`${API}/dashboard`, () => HttpResponse.json({ codigo: "error_interno", mensaje: "No se pudo leer el resumen" },
                                                          { status: 500 })),
    );
    renderizar("/");
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo leer el resumen");
    await waitFor(() => expect(tarjeta("Vender")).toHaveTextContent("Vender—"));
    expect(tarjeta("Vender")).toHaveAttribute("href", "/ventas");
    expect(tarjeta("Pagar")).toHaveTextContent("Pagar—");
    expect(tarjeta("Recibir leche")).toHaveTextContent("Recibir leche120.5 Lrecolectados hoy");
  });
});
