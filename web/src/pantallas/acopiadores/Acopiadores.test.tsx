import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import type { Acopiador } from "../../api/tipos";
import { respuestaLogin } from "../../pruebas/datos";
import { acopiador } from "../../pruebas/fabricas";
import { renderizar } from "../../pruebas/renderizar";
import { API, servidor } from "../../pruebas/servidor";
import { guardarSesion } from "../../sesion/almacen";

beforeEach(() => {
  guardarSesion(respuestaLogin());
});

function lista(acopiadores: Acopiador[]) {
  servidor.use(http.get(`${API}/acopiadores`, () => HttpResponse.json(acopiadores)));
}

function fila(nombre: string): HTMLElement {
  return screen.getByRole("link", { name: nombre }).closest("tr")!;
}

describe("lista de acopiadores", () => {
  it("muestra el estado de acceso según la prioridad", async () => {
    lista([
      acopiador({ id: 1, nombre_completo: "A Vinculado" }),
      acopiador({ id: 2, nombre_completo: "B Pendiente", pin_pendiente: true, celular_vinculado: false }),
      acopiador({ id: 3, nombre_completo: "C Bloqueado", pin_bloqueado: true, pin_pendiente: true }),
      acopiador({ id: 4, nombre_completo: "D Sin celular", celular_vinculado: false }),
    ]);
    renderizar("/acopiadores");

    expect(await screen.findByRole("link", { name: "A Vinculado" })).toBeInTheDocument();
    expect(within(fila("A Vinculado")).getByText("Celular vinculado")).toBeInTheDocument();
    expect(within(fila("B Pendiente")).getByText("Pendiente de activar")).toBeInTheDocument();
    expect(within(fila("C Bloqueado")).getByText("PIN bloqueado")).toBeInTheDocument();   // gana a pendiente
    expect(within(fila("D Sin celular")).getByText("Sin celular")).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Acopiadores · Quesería Huata"));
  });

  it("los inactivos se ocultan hasta marcar 'Mostrar inactivos', y se ven como Inactivo", async () => {
    lista([acopiador({ id: 1, nombre_completo: "Activo Uno" }),
           acopiador({ id: 2, nombre_completo: "Inactivo Dos", activo: false, pin_bloqueado: true })]);
    renderizar("/acopiadores");

    await screen.findByRole("link", { name: "Activo Uno" });
    expect(screen.queryByRole("link", { name: "Inactivo Dos" })).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByLabelText("Mostrar inactivos"));
    expect(within(fila("Inactivo Dos")).getByText("Inactivo")).toBeInTheDocument();   // gana a PIN bloqueado
  });

  it("busca por nombre o DNI", async () => {
    lista([acopiador({ id: 1, nombre_completo: "Rosa Condori", dni: "42345678" }),
           acopiador({ id: 2, nombre_completo: "Juan Mamani", dni: "41234567" })]);
    renderizar("/acopiadores");
    const usuario = userEvent.setup();
    await screen.findByRole("link", { name: "Rosa Condori" });

    await usuario.type(screen.getByLabelText("Buscar"), "rosa");
    expect(screen.queryByRole("link", { name: "Juan Mamani" })).not.toBeInTheDocument();

    await usuario.clear(screen.getByLabelText("Buscar"));
    await usuario.type(screen.getByLabelText("Buscar"), "4123");
    expect(screen.getByRole("link", { name: "Juan Mamani" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Rosa Condori" })).not.toBeInTheDocument();

    await usuario.type(screen.getByLabelText("Buscar"), "9999");
    expect(screen.getByText("Ningún acopiador coincide con la búsqueda.")).toBeInTheDocument();
  });

  it("marca 'Sin rutas', muestra el vehículo y enlaza al detalle", async () => {
    lista([acopiador({ id: 9, nombre_completo: "Sin Ruta", rutas: [], vehiculo: "vehiculo_mediano" })]);
    renderizar("/acopiadores");

    await screen.findByRole("link", { name: "Sin Ruta" });
    const f = fila("Sin Ruta");
    expect(within(f).getByText("Sin rutas")).toBeInTheDocument();
    expect(within(f).getByText("Vehículo mediano")).toBeInTheDocument();
    expect(within(f).getByRole("link", { name: "Sin Ruta" })).toHaveAttribute("href", "/acopiadores/9");
  });

  it("dibuja el color como SVG y no dibuja un color con formato inválido", async () => {
    lista([acopiador({ id: 1, nombre_completo: "Color Bueno", color_hex: "#16A34A" }),
           acopiador({ id: 2, nombre_completo: "Color Malo", color_hex: "red;x" })]);
    renderizar("/acopiadores");

    await screen.findByRole("link", { name: "Color Bueno" });
    const bueno = within(fila("Color Bueno"));
    expect(bueno.getByRole("img", { name: "Color #16A34A" }).querySelector("rect")).toHaveAttribute("fill", "#16A34A");
    const malo = within(fila("Color Malo"));
    expect(malo.queryByRole("img")).not.toBeInTheDocument();
    expect(malo.getByLabelText("Sin color")).toBeInTheDocument();
    expect(document.querySelector("[style]")).toBeNull();          // nada de atributos style (CSP)
  });

  it("si falla la carga, lo dice y deja reintentar", async () => {
    let intentos = 0;
    servidor.use(http.get(`${API}/acopiadores`, () => {
      intentos += 1;
      return intentos === 1
        ? HttpResponse.json({ codigo: "error_interno", mensaje: "Error interno en la base de datos" }, { status: 500 })
        : HttpResponse.json([acopiador()]);
    }));
    renderizar("/acopiadores");

    expect(await screen.findByRole("alert")).toHaveTextContent("Error interno en la base de datos");
    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("link", { name: "Juan Carlos Mamani Quispe" })).toBeInTheDocument();
  });

  it("sin acopiadores lo dice", async () => {
    lista([]);
    renderizar("/acopiadores");
    expect(await screen.findByText("Todavía no hay acopiadores.")).toBeInTheDocument();
  });
});
