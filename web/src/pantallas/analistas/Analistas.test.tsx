import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import type { Analista } from "../../api/tipos";
import { respuestaLogin } from "../../pruebas/datos";
import { analista } from "../../pruebas/fabricas";
import { irPorMenu } from "../../pruebas/menu";
import { renderizar, ubicacion } from "../../pruebas/renderizar";
import { API, servidor } from "../../pruebas/servidor";
import { guardarSesion } from "../../sesion/almacen";

beforeEach(() => {
  guardarSesion(respuestaLogin());
});

function lista(analistas: Analista[]) {
  servidor.use(http.get(`${API}/analistas`, () => HttpResponse.json(analistas)));
}

function fila(nombre: string): HTMLElement {
  return screen.getByRole("link", { name: nombre }).closest("tr")!;
}

describe("lista de analistas", () => {
  it("el menú lleva a Analistas", async () => {
    lista([analista()]);
    renderizar("/");
    await irPorMenu(userEvent.setup(), "Personal", "Analistas");

    expect(ubicacion()).toBe("/analistas");
    expect(await screen.findByRole("heading", { name: "Analistas" })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Analistas · Quesería Huata"));
  });

  it("muestra el estado de acceso y no tiene columnas de acopiador", async () => {
    lista([
      analista({ id: 1, nombre_completo: "A Vinculado" }),
      analista({ id: 2, nombre_completo: "B Pendiente", pin_pendiente: true, celular_vinculado: false }),
      analista({ id: 3, nombre_completo: "C Bloqueado", pin_bloqueado: true }),
    ]);
    renderizar("/analistas");

    expect(await screen.findByRole("link", { name: "A Vinculado" })).toHaveAttribute("href", "/analistas/1");
    expect(within(fila("A Vinculado")).getByText("Celular vinculado")).toBeInTheDocument();
    expect(within(fila("B Pendiente")).getByText("Pendiente de activar")).toBeInTheDocument();
    expect(within(fila("C Bloqueado")).getByText("PIN bloqueado")).toBeInTheDocument();
    const columnas = screen.getAllByRole("columnheader").map((c) => c.textContent);
    expect(columnas).toEqual(["Nombre", "DNI", "Celular", "Acceso al celular"]);
  });

  it("los inactivos se ocultan hasta marcar 'Mostrar inactivos'", async () => {
    lista([analista({ id: 1, nombre_completo: "Activa Uno" }),
           analista({ id: 2, nombre_completo: "Inactiva Dos", activo: false })]);
    renderizar("/analistas");

    await screen.findByRole("link", { name: "Activa Uno" });
    expect(screen.queryByRole("link", { name: "Inactiva Dos" })).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByLabelText("Mostrar inactivos"));
    expect(within(fila("Inactiva Dos")).getByText("Inactivo")).toBeInTheDocument();
  });

  it("busca por nombre o DNI", async () => {
    lista([analista({ id: 1, nombre_completo: "Rosa Condori", dni: "42345678" }),
           analista({ id: 2, nombre_completo: "Juan Mamani", dni: "41234567" })]);
    renderizar("/analistas");
    const usuario = userEvent.setup();
    await screen.findByRole("link", { name: "Rosa Condori" });

    await usuario.type(screen.getByLabelText("Buscar"), "4123");
    expect(screen.queryByRole("link", { name: "Rosa Condori" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Juan Mamani" })).toBeInTheDocument();

    await usuario.clear(screen.getByLabelText("Buscar"));
    await usuario.type(screen.getByLabelText("Buscar"), "nadie");
    expect(screen.getByText("Ningún analista coincide con la búsqueda.")).toBeInTheDocument();
  });

  it("sin analistas lo dice", async () => {
    lista([]);
    renderizar("/analistas");
    expect(await screen.findByText("Todavía no hay analistas.")).toBeInTheDocument();
  });

  it("si la API falla, muestra el mensaje y permite reintentar", async () => {
    let fallar = true;
    servidor.use(http.get(`${API}/analistas`, () => (fallar
      ? HttpResponse.json({ codigo: "error_interno", mensaje: "Error interno del servidor" }, { status: 500 })
      : HttpResponse.json([analista()]))));
    renderizar("/analistas");

    expect(await screen.findByRole("alert")).toHaveTextContent("Error interno del servidor");
    fallar = false;
    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("link", { name: "María Elena Ccama Apaza" })).toBeInTheDocument();
  });
});
