import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Jornada, MermaNueva } from "../../api/tipos";
import { respuestaLogin } from "../../pruebas/datos";
import { irPorMenu } from "../../pruebas/menu";
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
    await irPorMenu(userEvent.setup(), "Revisión", "Leche del día");

    expect(ubicacion()).toBe("/jornadas");
    expect(await screen.findByText(/2 días con leche/)).toBeInTheDocument();
    // Inicio (/) también pide jornadas (las de los últimos 30 días): se mira la de esta pantalla
    expect(consultas.at(-1)).toBe("?desde=2026-10-05&hasta=2026-10-18");
    const filas = screen.getAllByRole("row").slice(1).map((f) => within(f).getAllByRole("cell").map((c) => c.textContent));
    expect(filas[0]).toEqual(["18/10/2026", "51 L", "0 L", "51 L", "0 L", "0 L", "0 L", "0 L", "S/ 86.70", "—", "Sin leche aprobada", ""]);
    expect(filas[1]).toEqual(["15/10/2026", "300 L", "20 L", "0 L", "280 L", "250 L", "10 L", "20 L", "S/ 510.00", "S/ 1.8214", "Sin destino", "Registrar merma"]);
    expect(filas[2]).toEqual(["Total", "351 L", "20 L", "51 L", "280 L", "250 L", "10 L", "20 L", "S/ 596.70", "", "", ""]);
    expect(screen.getByText(/1 jornada tiene leche aprobada sin lote ni merma/)).toBeInTheDocument();
    // Estados con ícono: sin destino (rojo) y sin leche aprobada (ámbar)
    const tabla = screen.getAllByRole("table")[0]!;
    expect(within(tabla).getByText("Sin destino")).toHaveClass("insignia-error");
    expect(within(tabla).getByText("Sin destino").querySelector("svg.icono-estado")).toHaveAttribute("aria-hidden", "true");
    expect(within(tabla).getByText("Sin leche aprobada")).toHaveClass("insignia-atencion");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Leche del día");
    await waitFor(() => expect(document.title).toBe("Leche del día · Quesería Huata"));
  });

  it("valida el rango antes de pedir y lo deja en la URL", async () => {
    const consultas = simular([]);
    renderizar("/jornadas");
    const usuario = userEvent.setup();
    await screen.findByText(/No hubo leche/);
    const vacio = screen.getByText(/No hubo leche/).closest(".vacio-bloque");
    expect(vacio).not.toBeNull();
    expect(vacio!.querySelector("svg.vacio-icono")).toHaveAttribute("aria-hidden", "true");

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

describe("registrar merma", () => {
  /** Jornadas del 15/10 (20 L disponibles) y 18/10 (sin leche aprobada); POST /mermas responde lo que se pida. */
  function simularMerma(respuesta?: () => Response) {
    const enviado: MermaNueva[] = [];
    const consultas = simular([
      jornada("2026-10-15"),
      jornada("2026-10-18", { litros_aprobados: 0, litros_usados: 0, litros_merma: 0, litros_disponibles: 0, costo_litro_util: null }),
    ]);
    servidor.use(http.post(`${API}/mermas`, async ({ request }) => {
      const datos = (await request.json()) as MermaNueva;
      enviado.push(datos);
      return respuesta?.() ?? HttpResponse.json({ id: 5, fecha: datos.fecha, litros: datos.litros, motivo: datos.motivo,
        registrado_por: 1, registrado_por_nombre: "Admin", creado_en: "2026-10-18T23:00:00-05:00", valor_perdida: 22.77 },
        { status: 201 });
    }));
    return { enviado, consultas };
  }

  it("solo en jornadas con leche disponible; propone lo disponible, exige motivo y recarga", async () => {
    const { enviado, consultas } = simularMerma();
    renderizar("/jornadas");
    const usuario = userEvent.setup();
    await screen.findByText(/2 días con leche/);
    expect(screen.queryByRole("button", { name: "Registrar merma del 18/10/2026" })).not.toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Registrar merma del 15/10/2026" }));

    const ventana = screen.getByRole("dialog", { name: "Registrar merma: jornada del 15/10/2026" });
    expect(within(ventana).getByLabelText("Litros perdidos")).toHaveValue("20");
    expect(within(ventana).getByLabelText("Litros perdidos")).toHaveAccessibleDescription(
      "Disponible: 20 L (aprobada, sin lote ni merma).");
    expect(ventana).toHaveTextContent("Pérdida estimada: S/ 36.43 (20 L a S/ 1.8214 por litro útil), en el resultado de octubre de 2026.");
    expect(ventana).toHaveTextContent("No cambia el flujo de caja: esa leche ya cuenta como pagada.");
    expect(ventana).toHaveTextContent("La merma no se puede borrar desde el panel.");

    await usuario.click(within(ventana).getByRole("button", { name: "Registrar merma" }));
    expect(within(ventana).getByLabelText("Motivo")).toHaveAccessibleDescription(/^Escriba el motivo/);
    await usuario.clear(within(ventana).getByLabelText("Litros perdidos"));
    await usuario.type(within(ventana).getByLabelText("Litros perdidos"), "12.505");
    await usuario.click(within(ventana).getByRole("button", { name: "Registrar merma" }));
    expect(within(ventana).getByLabelText("Litros perdidos")).toHaveAccessibleDescription(/^Litros mayores que cero, con hasta 2 decimales/);
    expect(enviado).toEqual([]);

    await usuario.clear(within(ventana).getByLabelText("Litros perdidos"));
    await usuario.type(within(ventana).getByLabelText("Litros perdidos"), "12.5");
    expect(ventana).toHaveTextContent("Pérdida estimada: S/ 22.77");
    await usuario.type(within(ventana).getByLabelText("Motivo"), " Se derramó un porongo ");
    await usuario.click(within(ventana).getByRole("button", { name: "Registrar merma" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(enviado).toEqual([{ fecha: "2026-10-15", litros: 12.5, motivo: "Se derramó un porongo" }]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Merma registrada: 12.5 L de la jornada del 15/10/2026, pérdida de S/ 22.77 en el resultado.");
    await waitFor(() => expect(consultas).toHaveLength(2));
  });

  it("el 409 de la base se muestra tal cual en la ventana, sin reescribirlo", async () => {
    const mensaje = "La merma supera la leche aprobada sin destino de la jornada 2026-10-15";
    const { enviado } = simularMerma(() => HttpResponse.json({ codigo: "conflicto", mensaje }, { status: 409 }));
    renderizar("/jornadas");
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole("button", { name: "Registrar merma del 15/10/2026" }));
    const ventana = screen.getByRole("dialog");
    await usuario.clear(within(ventana).getByLabelText("Litros perdidos"));
    await usuario.type(within(ventana).getByLabelText("Litros perdidos"), "25");   // más de lo disponible: decide la base
    await usuario.type(within(ventana).getByLabelText("Motivo"), "Se agrió");
    await usuario.click(within(ventana).getByRole("button", { name: "Registrar merma" }));
    expect((await within(ventana).findByRole("alert")).textContent).toBe(mensaje);
    expect(enviado).toEqual([{ fecha: "2026-10-15", litros: 25, motivo: "Se agrió" }]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
