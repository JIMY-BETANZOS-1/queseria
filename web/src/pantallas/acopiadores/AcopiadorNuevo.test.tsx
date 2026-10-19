import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AcopiadorNuevo as DatosNuevo } from "../../api/tipos";
import { respuestaLogin } from "../../pruebas/datos";
import { acopiador } from "../../pruebas/fabricas";
import { renderizar, ubicacion } from "../../pruebas/renderizar";
import { API, servidor } from "../../pruebas/servidor";
import { guardarSesion } from "../../sesion/almacen";
import { colorLibre } from "./AcopiadorNuevo";

beforeEach(() => {
  guardarSesion(respuestaLogin());
  servidor.use(
    http.get(`${API}/acopiadores`, () => HttpResponse.json([acopiador({ color_hex: "#2563EB" })])),
    http.get(`${API}/usuarios/:id/dispositivos`, () => HttpResponse.json([])),
  );
});

async function llenar(datos: Partial<Record<string, string>> = {}) {
  const usuario = userEvent.setup();
  const v = { nombre: "Ana Quispe Flores", dni: "45678912", celular: "987654321", ...datos };
  if (v.nombre) await usuario.type(screen.getByLabelText("Nombre completo"), v.nombre);
  if (v.dni) await usuario.type(screen.getByLabelText("DNI"), v.dni);
  if (v.celular) await usuario.type(screen.getByLabelText("Celular"), v.celular);
  return usuario;
}

describe("nuevo acopiador", () => {
  it("propone un color que nadie usa", async () => {
    renderizar("/acopiadores/nuevo");
    expect(await screen.findByLabelText("Color en el mapa y las listas")).toHaveValue("#16a34a");
    expect(colorLibre(["#2563eb", "#16A34A"])).toBe("#DC2626");
  });

  it("no pide PIN", async () => {
    renderizar("/acopiadores/nuevo");
    await screen.findByLabelText("Nombre completo");
    expect(screen.queryByLabelText(/PIN/)).not.toBeInTheDocument();
  });

  it("valida en el navegador y no envía datos malos", async () => {
    const envio = vi.fn();
    servidor.use(http.post(`${API}/acopiadores`, () => {
      envio();
      return HttpResponse.json(acopiador(), { status: 201 });
    }));
    renderizar("/acopiadores/nuevo");
    await screen.findByLabelText("Nombre completo");

    const usuario = await llenar({ nombre: "", dni: "1234", celular: "12345678" });
    await usuario.clear(screen.getByLabelText("Sueldo base mensual (S/)"));
    await usuario.type(screen.getByLabelText("Sueldo base mensual (S/)"), "-5");
    await usuario.clear(screen.getByLabelText("Comisión por litro normal (S/)"));
    await usuario.type(screen.getByLabelText("Comisión por litro normal (S/)"), "0.0505");
    await usuario.click(screen.getByRole("button", { name: "Crear acopiador" }));

    expect(screen.getByText("Escriba el nombre completo")).toBeInTheDocument();
    expect(screen.getByLabelText("DNI")).toHaveAccessibleDescription("El DNI debe tener 8 dígitos");
    expect(screen.getByLabelText("Celular")).toHaveAccessibleDescription("El celular debe tener 9 dígitos");
    expect(screen.getByText("Monto en soles, 0 o más, con hasta 2 decimales")).toBeInTheDocument();
    expect(screen.getByText("Soles por litro, 0 o más, con hasta 3 decimales")).toBeInTheDocument();
    expect(envio).not.toHaveBeenCalled();
  });

  it("envía exactamente los datos y va al detalle con el aviso de pendiente de activar", async () => {
    let cuerpo: DatosNuevo | null = null;
    servidor.use(
      http.post(`${API}/acopiadores`, async ({ request }) => {
        cuerpo = (await request.json()) as DatosNuevo;
        return HttpResponse.json(acopiador({ id: 55, nombre_completo: "Ana Quispe Flores", pin_pendiente: true,
                                             celular_vinculado: false, rutas: [] }), { status: 201 });
      }),
      http.get(`${API}/acopiadores/55`, () => HttpResponse.json(acopiador({
        id: 55, nombre_completo: "Ana Quispe Flores", pin_pendiente: true, celular_vinculado: false, rutas: [] }))),
    );
    renderizar("/acopiadores/nuevo");
    await screen.findByLabelText("Nombre completo");

    const usuario = await llenar({ nombre: "  Ana Quispe Flores  " });
    await usuario.selectOptions(screen.getByLabelText("Vehículo"), "Motocarga");
    await usuario.clear(screen.getByLabelText("Sueldo base mensual (S/)"));
    await usuario.type(screen.getByLabelText("Sueldo base mensual (S/)"), "850.5");
    await usuario.clear(screen.getByLabelText("Comisión por litro normal (S/)"));
    await usuario.type(screen.getByLabelText("Comisión por litro normal (S/)"), "0.045");
    await usuario.click(screen.getByRole("button", { name: "Crear acopiador" }));

    await waitFor(() => expect(ubicacion()).toBe("/acopiadores/55"));
    expect(cuerpo).toEqual({
      nombre_completo: "Ana Quispe Flores", dni: "45678912", celular: "987654321", color_hex: "#16A34A",
      vehiculo: "motocarga", sueldo_base_mensual: 850.5, comision_por_litro: 0.045,
    });
    expect(await screen.findByText(/Acopiador creado\. Está pendiente de activar/)).toBeInTheDocument();
    expect(screen.getByText("Pendiente de activar")).toBeInTheDocument();
  });

  it("422 del servidor: el mensaje va bajo su campo", async () => {
    servidor.use(http.post(`${API}/acopiadores`, () => HttpResponse.json({
      codigo: "validacion", mensaje: "Datos inválidos", errores: [{ campo: "celular", mensaje: "Formato inválido" }],
    }, { status: 422 })));
    renderizar("/acopiadores/nuevo");
    await screen.findByLabelText("Nombre completo");

    const usuario = await llenar();
    await usuario.click(screen.getByRole("button", { name: "Crear acopiador" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Revise los datos marcados.");
    expect(screen.getByLabelText("Celular")).toHaveAccessibleDescription("Formato inválido");
    expect(ubicacion()).toBe("/acopiadores/nuevo");
  });

  it.each([
    ["Ya existe un usuario con ese DNI"],
    ["Ese color ya lo usa otro acopiador"],
  ])("409 '%s': aviso arriba y no navega", async (mensaje) => {
    servidor.use(http.post(`${API}/acopiadores`, () =>
      HttpResponse.json({ codigo: "conflicto", mensaje }, { status: 409 })));
    renderizar("/acopiadores/nuevo");
    await screen.findByLabelText("Nombre completo");

    const usuario = await llenar();
    await usuario.click(screen.getByRole("button", { name: "Crear acopiador" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(mensaje);
    expect(screen.getByLabelText("Nombre completo")).toHaveValue("Ana Quispe Flores");   // no se pierde lo escrito
    expect(ubicacion()).toBe("/acopiadores/nuevo");
  });
});
