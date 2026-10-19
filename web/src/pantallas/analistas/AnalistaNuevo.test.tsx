import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalistaNuevo as DatosNuevo } from "../../api/tipos";
import { respuestaLogin } from "../../pruebas/datos";
import { analista } from "../../pruebas/fabricas";
import { renderizar, ubicacion } from "../../pruebas/renderizar";
import { API, servidor } from "../../pruebas/servidor";
import { guardarSesion } from "../../sesion/almacen";

beforeEach(() => {
  guardarSesion(respuestaLogin());
  servidor.use(http.get(`${API}/usuarios/:id/dispositivos`, () => HttpResponse.json([])));
});

async function llenar(datos: Partial<Record<string, string>> = {}) {
  const usuario = userEvent.setup();
  const v = { nombre: "Ana Quispe Flores", dni: "45678912", celular: "987654321", ...datos };
  if (v.nombre) await usuario.type(screen.getByLabelText("Nombre completo"), v.nombre);
  if (v.dni) await usuario.type(screen.getByLabelText("DNI"), v.dni);
  if (v.celular) await usuario.type(screen.getByLabelText("Celular"), v.celular);
  return usuario;
}

describe("nuevo analista", () => {
  it("solo pide nombre, DNI y celular: sin PIN, rutas, vehículo, color ni sueldo", async () => {
    renderizar("/analistas/nuevo");
    await screen.findByLabelText("Nombre completo");

    const campos = Array.from(document.querySelectorAll("form label")).map((l) => l.textContent);
    expect(campos).toEqual(["Nombre completo", "DNI", "Celular"]);
    expect(screen.queryByLabelText(/PIN/)).not.toBeInTheDocument();
  });

  it("valida en el navegador y no envía datos malos", async () => {
    const envio = vi.fn();
    servidor.use(http.post(`${API}/analistas`, () => {
      envio();
      return HttpResponse.json(analista(), { status: 201 });
    }));
    renderizar("/analistas/nuevo");
    await screen.findByLabelText("Nombre completo");

    const usuario = await llenar({ nombre: "", dni: "1234567", celular: "12345678" });
    await usuario.click(screen.getByRole("button", { name: "Crear analista" }));

    expect(screen.getByLabelText("Nombre completo")).toHaveAccessibleDescription("Escriba el nombre completo");
    expect(screen.getByLabelText("DNI")).toHaveAccessibleDescription("El DNI debe tener 8 dígitos");
    expect(screen.getByLabelText("Celular")).toHaveAccessibleDescription("El celular debe tener 9 dígitos");
    expect(envio).not.toHaveBeenCalled();
  });

  it("envía exactamente los datos y va al detalle con el aviso de pendiente de activar", async () => {
    let cuerpo: DatosNuevo | null = null;
    const creado = analista({ id: 56, nombre_completo: "Ana Quispe Flores", pin_pendiente: true, celular_vinculado: false });
    servidor.use(
      http.post(`${API}/analistas`, async ({ request }) => {
        cuerpo = (await request.json()) as DatosNuevo;
        return HttpResponse.json(creado, { status: 201 });
      }),
      http.get(`${API}/analistas/56`, () => HttpResponse.json(creado)),
    );
    renderizar("/analistas/nuevo");
    await screen.findByLabelText("Nombre completo");

    const usuario = await llenar({ nombre: "  Ana Quispe Flores  " });
    await usuario.click(screen.getByRole("button", { name: "Crear analista" }));

    await waitFor(() => expect(ubicacion()).toBe("/analistas/56"));
    expect(cuerpo).toEqual({ nombre_completo: "Ana Quispe Flores", dni: "45678912", celular: "987654321" });
    expect(await screen.findByText(/Analista creado\. Está pendiente de activar/)).toBeInTheDocument();
    expect(screen.getByText("Pendiente de activar")).toBeInTheDocument();
  });

  it("422 del servidor: el mensaje va bajo su campo", async () => {
    servidor.use(http.post(`${API}/analistas`, () => HttpResponse.json({
      codigo: "validacion", mensaje: "Datos inválidos", errores: [{ campo: "dni", mensaje: "Formato inválido" }],
    }, { status: 422 })));
    renderizar("/analistas/nuevo");
    await screen.findByLabelText("Nombre completo");

    const usuario = await llenar();
    await usuario.click(screen.getByRole("button", { name: "Crear analista" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Revise los datos marcados.");
    expect(screen.getByLabelText("DNI")).toHaveAccessibleDescription("Formato inválido");
    expect(ubicacion()).toBe("/analistas/nuevo");
  });

  it("409 de DNI repetido: aviso arriba, no navega y no se pierde lo escrito", async () => {
    servidor.use(http.post(`${API}/analistas`, () =>
      HttpResponse.json({ codigo: "conflicto", mensaje: "Ya existe un usuario con ese DNI" }, { status: 409 })));
    renderizar("/analistas/nuevo");
    await screen.findByLabelText("Nombre completo");

    const usuario = await llenar();
    await usuario.click(screen.getByRole("button", { name: "Crear analista" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ya existe un usuario con ese DNI");
    expect(screen.getByLabelText("Nombre completo")).toHaveValue("Ana Quispe Flores");
    expect(ubicacion()).toBe("/analistas/nuevo");
  });
});
