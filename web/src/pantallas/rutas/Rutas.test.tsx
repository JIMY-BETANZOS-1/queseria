import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Ruta, RutaNueva as DatosNueva } from "../../api/tipos";
import { respuestaLogin } from "../../pruebas/datos";
import { ruta } from "../../pruebas/fabricas";
import { renderizar, ubicacion } from "../../pruebas/renderizar";
import { API, servidor } from "../../pruebas/servidor";
import { guardarSesion } from "../../sesion/almacen";

beforeEach(() => {
  guardarSesion(respuestaLogin());
});

function lista(rutas: Ruta[]) {
  servidor.use(http.get(`${API}/rutas`, () => HttpResponse.json(rutas)));
}

function fila(nombre: string): HTMLElement {
  return screen.getByRole("link", { name: nombre }).closest("tr")!;
}

describe("lista de rutas", () => {
  it("el menú lleva a Rutas", async () => {
    lista([ruta()]);
    renderizar("/");
    await userEvent.setup().click(
      within(screen.getByRole("navigation", { name: "Menú principal" })).getByRole("link", { name: "Rutas" }));

    expect(ubicacion()).toBe("/rutas");
    expect(await screen.findByRole("link", { name: "Ruta 4 - Collana" })).toHaveAttribute("href", "/rutas/21");
    await waitFor(() => expect(document.title).toBe("Rutas · Quesería Huata"));
  });

  it("muestra el acopiador vigente con enlace, o 'Sin acopiador'", async () => {
    lista([ruta(), ruta({ id: 22, nombre: "Ruta 5 - Capachica", descripcion: null, acopiador_id: null, acopiador: null,
                          color_hex: null })]);
    renderizar("/rutas");

    await screen.findByRole("link", { name: "Ruta 4 - Collana" });
    expect(within(fila("Ruta 4 - Collana")).getByRole("link", { name: "Juan Carlos Mamani Quispe" }))
      .toHaveAttribute("href", "/acopiadores/7");
    expect(within(fila("Ruta 4 - Collana")).getByText("Collana y Yanamayo")).toBeInTheDocument();
    expect(within(fila("Ruta 5 - Capachica")).getByText("Sin acopiador")).toBeInTheDocument();
  });

  it("las inactivas se ocultan hasta marcar 'Mostrar inactivas'", async () => {
    lista([ruta({ id: 1, nombre: "Activa" }), ruta({ id: 2, nombre: "Vieja", activa: false })]);
    renderizar("/rutas");

    await screen.findByRole("link", { name: "Activa" });
    expect(screen.queryByRole("link", { name: "Vieja" })).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByLabelText("Mostrar inactivas"));
    expect(within(fila("Vieja")).getByText("Inactiva")).toBeInTheDocument();
  });

  it("busca por nombre", async () => {
    lista([ruta({ id: 1, nombre: "Ruta 4 - Collana" }), ruta({ id: 2, nombre: "Ruta 5 - Capachica" })]);
    renderizar("/rutas");
    const usuario = userEvent.setup();
    await screen.findByRole("link", { name: "Ruta 4 - Collana" });

    await usuario.type(screen.getByLabelText("Buscar"), "capa");
    expect(screen.queryByRole("link", { name: "Ruta 4 - Collana" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ruta 5 - Capachica" })).toBeInTheDocument();
  });

  it("sin rutas lo dice; si la API falla, permite reintentar", async () => {
    let fallar = true;
    servidor.use(http.get(`${API}/rutas`, () => (fallar
      ? HttpResponse.json({ codigo: "error_interno", mensaje: "Error interno del servidor" }, { status: 500 })
      : HttpResponse.json([]))));
    renderizar("/rutas");

    expect(await screen.findByRole("alert")).toHaveTextContent("Error interno del servidor");
    fallar = false;
    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Todavía no hay rutas.")).toBeInTheDocument();
  });
});

describe("nueva ruta", () => {
  it("exige el nombre y no envía nada sin él", async () => {
    const envio = vi.fn();
    servidor.use(http.post(`${API}/rutas`, () => {
      envio();
      return HttpResponse.json(ruta(), { status: 201 });
    }));
    renderizar("/rutas/nueva");

    await userEvent.setup().click(await screen.findByRole("button", { name: "Crear ruta" }));
    expect(screen.getByLabelText("Nombre")).toHaveAccessibleDescription("Escriba el nombre de la ruta");
    expect(envio).not.toHaveBeenCalled();
  });

  it("envía nombre sin espacios y descripción vacía como null; va al detalle con el aviso", async () => {
    let cuerpo: DatosNueva | null = null;
    const creada = ruta({ id: 40, nombre: "PRUEBA W1 — Ruta", descripcion: null, acopiador_id: null, acopiador: null,
                          color_hex: null });
    servidor.use(
      http.post(`${API}/rutas`, async ({ request }) => {
        cuerpo = (await request.json()) as DatosNueva;
        return HttpResponse.json(creada, { status: 201 });
      }),
      http.get(`${API}/rutas/40`, () => HttpResponse.json(creada)),
      http.get(`${API}/rutas/40/asignaciones`, () => HttpResponse.json([])),
    );
    renderizar("/rutas/nueva");
    const usuario = userEvent.setup();

    await usuario.type(await screen.findByLabelText("Nombre"), "  PRUEBA W1 — Ruta ");
    await usuario.type(screen.getByLabelText("Descripción (opcional)"), "   ");
    await usuario.click(screen.getByRole("button", { name: "Crear ruta" }));

    await waitFor(() => expect(ubicacion()).toBe("/rutas/40"));
    expect(cuerpo).toEqual({ nombre: "PRUEBA W1 — Ruta", descripcion: null });
    expect(await screen.findByText("Ruta creada. Todavía no tiene acopiador: asígnelo más abajo.")).toBeInTheDocument();
  });

  it("409 de nombre repetido: aviso arriba y no navega", async () => {
    servidor.use(http.post(`${API}/rutas`, () =>
      HttpResponse.json({ codigo: "conflicto", mensaje: "Ya existe una ruta con ese nombre" }, { status: 409 })));
    renderizar("/rutas/nueva");
    const usuario = userEvent.setup();

    await usuario.type(await screen.findByLabelText("Nombre"), "Ruta 1 - Huata Centro");
    await usuario.click(screen.getByRole("button", { name: "Crear ruta" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ya existe una ruta con ese nombre");
    expect(screen.getByLabelText("Nombre")).toHaveValue("Ruta 1 - Huata Centro");
    expect(ubicacion()).toBe("/rutas/nueva");
  });
});
