import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Jornada } from "../../api/tipos";
import { respuestaLogin } from "../../pruebas/datos";
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

function jornada(fecha: string, cambios: Partial<Jornada> = {}): Jornada {
  return { fecha, litros_recolectados: 300, litros_descartados: 20, litros_por_revisar: 0, litros_aprobados: 280,
           litros_usados: 250, litros_merma: 10, litros_disponibles: 20, costo_pagado: 510, costo_litro_util: 1.8214,
           dias_antiguedad: 3, sin_destino: false, ...cambios };
}

function simular(filas: Jornada[]) {
  const consultas: string[] = [];
  servidor.use(http.get(`${API}/jornadas`, ({ request }) => {
    consultas.push(new URL(request.url).search);
    return HttpResponse.json(filas);
  }));
  return consultas;
}

describe("leche de la jornada", () => {
  it("el menú lleva a la pantalla: últimos 14 días en Lima, del más reciente al más antiguo, con totales", async () => {
    const consultas = simular([
      jornada("2026-10-15", { sin_destino: true }),
      jornada("2026-10-18", { litros_recolectados: 51, litros_descartados: 0, litros_por_revisar: 51, litros_aprobados: 0,
                              litros_usados: 0, litros_merma: 0, litros_disponibles: 0, costo_pagado: 86.7,
                              costo_litro_util: null, dias_antiguedad: 0 }),
    ]);
    renderizar("/");
    await userEvent.setup().click(within(screen.getByRole("navigation", { name: "Menú principal" }))
      .getByRole("link", { name: "Leche de la jornada" }));

    expect(ubicacion()).toBe("/jornadas");
    expect(await screen.findByText(/2 días con leche/)).toBeInTheDocument();
    expect(consultas).toEqual(["?desde=2026-10-05&hasta=2026-10-18"]);
    const filas = screen.getAllByRole("row").slice(1).map((f) => within(f).getAllByRole("cell").map((c) => c.textContent));
    expect(filas[0]).toEqual(["18/10/2026", "51 L", "0 L", "51 L", "0 L", "0 L", "0 L", "0 L", "S/ 86.70", "—", "Sin leche aprobada"]);
    expect(filas[1]).toEqual(["15/10/2026", "300 L", "20 L", "0 L", "280 L", "250 L", "10 L", "20 L", "S/ 510.00", "S/ 1.8214", "Sin destino"]);
    expect(filas[2]).toEqual(["Total", "351 L", "20 L", "51 L", "280 L", "250 L", "10 L", "20 L", "S/ 596.70", "", ""]);
    expect(screen.getByText(/1 jornada tiene leche aprobada sin lote ni merma/)).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Leche de la jornada · Quesería Huata"));
  });

  it("valida el rango antes de pedir y lo deja en la URL", async () => {
    const consultas = simular([]);
    renderizar("/jornadas");
    const usuario = userEvent.setup();
    await screen.findByText(/No hubo leche/);

    await usuario.clear(screen.getByLabelText("Desde"));
    await usuario.type(screen.getByLabelText("Desde"), "2026-10-10");
    await usuario.clear(screen.getByLabelText("Hasta"));
    await usuario.type(screen.getByLabelText("Hasta"), "2026-10-01");
    await usuario.click(screen.getByRole("button", { name: "Ver" }));
    expect(screen.getByLabelText("Hasta")).toHaveAccessibleDescription("No puede ser anterior a la fecha inicial");

    await usuario.clear(screen.getByLabelText("Desde"));
    await usuario.type(screen.getByLabelText("Desde"), "2025-01-01");
    await usuario.clear(screen.getByLabelText("Hasta"));
    await usuario.type(screen.getByLabelText("Hasta"), "2026-10-01");
    await usuario.click(screen.getByRole("button", { name: "Ver" }));
    expect(screen.getByLabelText("Hasta")).toHaveAccessibleDescription("Elija como máximo 400 días");
    expect(consultas).toEqual(["?desde=2026-10-05&hasta=2026-10-18"]);

    await usuario.clear(screen.getByLabelText("Desde"));
    await usuario.type(screen.getByLabelText("Desde"), "2026-10-01");
    await usuario.click(screen.getByRole("button", { name: "Ver" }));
    expect(ubicacion()).toBe("/jornadas?desde=2026-10-01&hasta=2026-10-01");
    await waitFor(() => expect(consultas.at(-1)).toBe("?desde=2026-10-01&hasta=2026-10-01"));
  });

  it("un rango inválido en la URL no llama a la API", async () => {
    const consultas = simular([]);
    renderizar("/jornadas?desde=2026-10-10&hasta=2026-10-01");
    expect(await screen.findByText(/El rango de la dirección no es válido/)).toBeInTheDocument();
    expect(consultas).toEqual([]);
  });
});
