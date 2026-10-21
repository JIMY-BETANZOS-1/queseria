import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReporteAnalista } from "../../api/tipos";
import { respuestaLogin } from "../../pruebas/datos";
import { renderizar } from "../../pruebas/renderizar";
import { API, servidor } from "../../pruebas/servidor";
import { guardarSesion } from "../../sesion/almacen";

const REPORTE: ReporteAnalista = {
  recoleccion_id: "5f1c0000-aaaa-4bbb-8ccc-000000000001",
  creado_en: "2026-10-21T14:05:00Z",
  productor_id: 7,
  productor_codigo: "P-0007",
  productor: "Cirilo Ticona Larico",
  tipo_productor: "de_ruta",
  ruta: "Ruta 2 - Orilla del lago",
  entrega_registrada_en: "2026-10-20T12:30:00Z",
  foto_url: "analisis/reporte-x.jpg",
};

beforeEach(() => {
  guardarSesion(respuestaLogin());
  servidor.use(http.get(`${API}/analistas`, () => HttpResponse.json([])));
  // jsdom no implementa URL.createObjectURL
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:foto-1"), revokeObjectURL: vi.fn() }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reportes del analista", () => {
  it("lista fecha, hora y productor, y avisa que el comentario queda en el celular", async () => {
    servidor.use(http.get(`${API}/analista/reportes`, () => HttpResponse.json([REPORTE])));
    renderizar("/analistas");

    const seccion = (await screen.findByRole("heading", { name: "Reportes del analista" })).closest("section")!;
    const fila = (await within(seccion).findByText("Cirilo Ticona Larico")).closest("tr")!;
    expect(within(fila).getByText("21/10/2026")).toBeInTheDocument();
    expect(within(fila).getByText("09:05")).toBeInTheDocument();
    expect(within(fila).getByText(/P-0007 · Ruta 2 - Orilla del lago/)).toBeInTheDocument();
    expect(within(fila).getByText("Solo en el celular")).toBeInTheDocument();
    expect(within(seccion).getByText(/no cambian la calidad ni generan sanciones/)).toBeInTheDocument();
  });

  it("baja la foto con el token y la muestra como blob:", async () => {
    let autorizacion: string | null = null;
    servidor.use(
      http.get(`${API}/analista/reportes`, () => HttpResponse.json([REPORTE])),
      http.get(`${API}/analisis/${REPORTE.recoleccion_id}/foto`, ({ request }) => {
        autorizacion = request.headers.get("Authorization");
        return new HttpResponse(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { "Content-Type": "image/jpeg" } });
      }),
    );
    renderizar("/analistas");

    await userEvent.setup().click(await screen.findByRole("button", { name: "Ver foto" }));
    const foto = await screen.findByRole("img", { name: "Foto del reporte de Cirilo Ticona Larico" });
    expect(foto).toHaveAttribute("src", "blob:foto-1");
    expect(autorizacion).toMatch(/^Bearer /);
  });

  it("sin reportes muestra el vacío", async () => {
    renderizar("/analistas");
    expect(await screen.findByText("Todavía no hay reportes del analista.")).toBeInTheDocument();
  });
});
