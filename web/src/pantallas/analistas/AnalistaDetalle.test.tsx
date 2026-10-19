import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Analista, AnalistaCambios } from "../../api/tipos";
import { respuestaLogin } from "../../pruebas/datos";
import { acopiador, analista, codigoActivacion, dispositivo } from "../../pruebas/fabricas";
import { estadoHistorial, renderizar, ubicacion } from "../../pruebas/renderizar";
import { API, servidor } from "../../pruebas/servidor";
import { guardarSesion } from "../../sesion/almacen";

beforeEach(() => {
  guardarSesion(respuestaLogin());
});

/** API simulada de un analista: GET devuelve el estado actual y PATCH lo cambia; registra los cuerpos. */
function simular(inicial: Analista) {
  let actual = inicial;
  const cuerpos: AnalistaCambios[] = [];
  servidor.use(
    http.get(`${API}/analistas/${inicial.id}`, () => HttpResponse.json(actual)),
    http.patch(`${API}/analistas/${inicial.id}`, async ({ request }) => {
      const cambios = (await request.json()) as AnalistaCambios;
      cuerpos.push(cambios);
      actual = { ...actual, ...(cambios as Partial<Analista>) };
      return HttpResponse.json(actual);
    }),
    http.get(`${API}/usuarios/${inicial.id}/dispositivos`, () => HttpResponse.json([dispositivo({ usuario_id: inicial.id })])),
    http.post(`${API}/usuarios/${inicial.id}/codigo-activacion`, () => HttpResponse.json(codigoActivacion(), { status: 201 })),
  );
  return cuerpos;
}

type Usuario = ReturnType<typeof userEvent.setup>;

async function confirmar(usuario: Usuario, boton: string) {
  await usuario.click(within(screen.getByRole("dialog")).getByRole("button", { name: boton }));
}

describe("detalle del analista", () => {
  it("muestra sus datos y el acceso al celular, sin rutas ni datos de acopiador", async () => {
    simular(analista());
    renderizar("/analistas/12");

    expect(await screen.findByRole("heading", { name: "María Elena Ccama Apaza" })).toBeInTheDocument();
    expect(screen.getByLabelText("DNI")).toHaveValue("43456789");
    expect(screen.getByLabelText("Celular")).toHaveValue("961234567");
    expect(screen.getByText("Celular vinculado")).toBeInTheDocument();
    expect(await screen.findByText("realme RMX3710")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Rutas vigentes" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Vehículo")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Sueldo/)).not.toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("María Elena Ccama Apaza · Quesería Huata"));
  });

  it("guardar envía solo lo que cambió, a /analistas", async () => {
    const cuerpos = simular(analista());
    renderizar("/analistas/12");
    const usuario = userEvent.setup();
    await screen.findByLabelText("Celular");

    await usuario.clear(screen.getByLabelText("Celular"));
    await usuario.type(screen.getByLabelText("Celular"), "999888777");
    await usuario.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByText("Cambios guardados.")).toBeInTheDocument();
    expect(cuerpos).toEqual([{ celular: "999888777" }]);
  });

  it("sin cambios no envía nada", async () => {
    const cuerpos = simular(analista());
    renderizar("/analistas/12");
    await screen.findByLabelText("Celular");

    await userEvent.setup().click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText("No hay cambios que guardar.")).toBeInTheDocument();
    expect(cuerpos).toEqual([]);
  });

  it("desactivar: confirmación propia del analista (sin hablar de lo pendiente en el celular) y solo activo=false", async () => {
    const cuerpos = simular(analista());
    renderizar("/analistas/12");
    const usuario = userEvent.setup();

    await usuario.click(await screen.findByRole("button", { name: "Desactivar analista" }));
    const ventana = screen.getByRole("dialog", { name: "Desactivar analista" });
    expect(ventana).toHaveTextContent("Corta su acceso al instante");
    expect(ventana).toHaveTextContent("Lo que ya registró o revisó en el servidor no cambia.");
    expect(ventana).not.toHaveTextContent("sin enviar");

    await confirmar(usuario, "Cancelar");
    expect(cuerpos).toEqual([]);

    await usuario.click(screen.getByRole("button", { name: "Desactivar analista" }));
    await confirmar(usuario, "Desactivar");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(cuerpos).toEqual([{ activo: false }]);
    expect(screen.getByRole("button", { name: "Reactivar analista" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generar código de activación" })).toBeDisabled();
  });

  it("reactivar avisa que su celular pudo desvincularse y envía solo activo=true", async () => {
    const cuerpos = simular(analista({ activo: false }));
    renderizar("/analistas/12");
    const usuario = userEvent.setup();

    await usuario.click(await screen.findByRole("button", { name: "Reactivar analista" }));
    const ventana = screen.getByRole("dialog", { name: "Reactivar analista" });
    expect(ventana).toHaveTextContent("Vuelve a poder entrar y sincronizar.");
    expect(ventana).toHaveTextContent("su celular quedó desvinculado: genere un código nuevo");

    await confirmar(usuario, "Reactivar");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(cuerpos).toEqual([{ activo: true }]);
  });

  describe("aviso de la app 0.7.0", () => {
    const AVISO = /La app actual \(0\.7\.0\) todavía no tiene las pantallas del analista/;

    it("el analista lo ve en Acceso al celular", async () => {
      simular(analista());
      renderizar("/analistas/12");
      const seccion = (await screen.findByRole("heading", { name: "Acceso al celular" })).closest("section")!;
      expect(within(seccion).getByText(AVISO))
        .toHaveTextContent('al sincronizar verá "Esta versión de la app es solo para acopiadores"');
    });

    it("el acopiador no lo ve", async () => {
      servidor.use(
        http.get(`${API}/acopiadores/7`, () => HttpResponse.json(acopiador())),
        http.get(`${API}/usuarios/7/dispositivos`, () => HttpResponse.json([])),
      );
      renderizar("/acopiadores/7");
      await screen.findByRole("heading", { name: "Acceso al celular" });
      expect(screen.queryByText(AVISO)).not.toBeInTheDocument();
    });
  });

  describe("aviso de 'Analista creado'", () => {
    const AVISO = /Analista creado\. Está pendiente de activar/;
    const nuevo = (cambios: Partial<Analista> = {}) =>
      analista({ pin_pendiente: true, celular_vinculado: false, ...cambios });

    it.each([
      ["guardar", async (u: Usuario) => {
        await u.clear(screen.getByLabelText("Celular"));
        await u.type(screen.getByLabelText("Celular"), "999888777");
        await u.click(screen.getByRole("button", { name: "Guardar cambios" }));
      }],
      ["desactivar", async (u: Usuario) => {
        await u.click(screen.getByRole("button", { name: "Desactivar analista" }));
        await confirmar(u, "Desactivar");
      }],
      ["generar código", async (u: Usuario) => {
        await u.click(screen.getByRole("button", { name: "Generar código de activación" }));
        await confirmar(u, "Generar código");
      }],
    ])("desaparece después de %s y no vuelve con F5", async (_accion, hacer) => {
      simular(nuevo());
      renderizar({ pathname: "/analistas/12", state: { creado: true } });
      const usuario = userEvent.setup();
      expect(await screen.findByText(AVISO)).toBeInTheDocument();

      await hacer(usuario);
      await waitFor(() => expect(screen.queryByText(AVISO)).not.toBeInTheDocument());
      expect(estadoHistorial()).toBeNull();
      expect(ubicacion()).toBe("/analistas/12");
    });

    it("sin venir de 'Nuevo' no aparece", async () => {
      simular(nuevo());
      renderizar("/analistas/12");
      expect(await screen.findByText("Pendiente de activar")).toBeInTheDocument();
      expect(screen.queryByText(AVISO)).not.toBeInTheDocument();
    });
  });

  it("un analista que no existe: mensaje del servidor", async () => {
    servidor.use(http.get(`${API}/analistas/999`, () =>
      HttpResponse.json({ codigo: "no_encontrado", mensaje: "El analista no existe" }, { status: 404 })));
    renderizar("/analistas/999");
    expect(await screen.findByRole("alert")).toHaveTextContent("El analista no existe");
  });

  it("un id que no es número no llama a la API", async () => {
    const llamada = vi.fn();
    servidor.use(http.get(`${API}/analistas/:id`, () => {
      llamada();
      return HttpResponse.json(analista());
    }));
    renderizar("/analistas/abc");
    expect(await screen.findByRole("alert")).toHaveTextContent("El analista no existe");
    expect(llamada).not.toHaveBeenCalled();
  });
});
