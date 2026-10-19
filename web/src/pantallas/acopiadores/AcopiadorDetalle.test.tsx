import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Acopiador, AcopiadorCambios } from "../../api/tipos";
import { respuestaLogin } from "../../pruebas/datos";
import { acopiador, dispositivo } from "../../pruebas/fabricas";
import { estadoHistorial, renderizar, ubicacion } from "../../pruebas/renderizar";
import { API, servidor } from "../../pruebas/servidor";
import { guardarSesion } from "../../sesion/almacen";

beforeEach(() => {
  guardarSesion(respuestaLogin());
});

/** API simulada de un acopiador: GET devuelve el estado actual y PATCH lo cambia; registra los cuerpos. */
function simular(inicial: Acopiador) {
  let actual = inicial;
  const cuerpos: AcopiadorCambios[] = [];
  servidor.use(
    http.get(`${API}/acopiadores/${inicial.id}`, () => HttpResponse.json(actual)),
    http.patch(`${API}/acopiadores/${inicial.id}`, async ({ request }) => {
      const cambios = (await request.json()) as AcopiadorCambios;
      cuerpos.push(cambios);
      actual = { ...actual, ...(cambios as Partial<Acopiador>) };
      return HttpResponse.json(actual);
    }),
    http.get(`${API}/usuarios/${inicial.id}/dispositivos`, () => HttpResponse.json([dispositivo()])),
  );
  return cuerpos;
}

describe("detalle del acopiador", () => {
  it("muestra datos, rutas con su fecha y el estado de acceso", async () => {
    simular(acopiador());
    renderizar("/acopiadores/7");

    expect(await screen.findByRole("heading", { name: /Juan Carlos Mamani Quispe/ })).toBeInTheDocument();
    expect(screen.getByLabelText("DNI")).toHaveValue("41234567");
    expect(screen.getByText("Ruta 1 - Huata Centro")).toBeInTheDocument();
    expect(screen.getByText("desde 18/09/2026")).toBeInTheDocument();
    expect(screen.getByText("Celular vinculado")).toBeInTheDocument();
    // El título se pone en un efecto, después de que llegan los datos
    await waitFor(() => expect(document.title).toBe("Juan Carlos Mamani Quispe · Quesería Huata"));
  });

  it("guardar envía solo lo que cambió", async () => {
    const cuerpos = simular(acopiador());
    renderizar("/acopiadores/7");
    const usuario = userEvent.setup();
    await screen.findByLabelText("Celular");

    await usuario.clear(screen.getByLabelText("Celular"));
    await usuario.type(screen.getByLabelText("Celular"), "999888777");
    await usuario.clear(screen.getByLabelText("Comisión por litro normal (S/)"));
    await usuario.type(screen.getByLabelText("Comisión por litro normal (S/)"), "0.06");
    await usuario.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByText("Cambios guardados.")).toBeInTheDocument();
    expect(cuerpos).toEqual([{ celular: "999888777", comision_por_litro: 0.06 }]);
  });

  it("sin cambios no envía nada", async () => {
    const cuerpos = simular(acopiador());
    renderizar("/acopiadores/7");
    await screen.findByLabelText("Celular");

    await userEvent.setup().click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText("No hay cambios que guardar.")).toBeInTheDocument();
    expect(cuerpos).toEqual([]);
  });

  it("desactivar pide confirmación con lo que pasa, y envía solo activo=false", async () => {
    const cuerpos = simular(acopiador());
    renderizar("/acopiadores/7");
    const usuario = userEvent.setup();

    await usuario.click(await screen.findByRole("button", { name: "Desactivar acopiador" }));
    const ventana = screen.getByRole("dialog", { name: "Desactivar acopiador" });
    expect(ventana).toHaveTextContent("Corta su acceso al instante");
    expect(ventana).toHaveTextContent("Lo que tenga sin enviar se queda guardado en su celular");

    await usuario.click(within(ventana).getByRole("button", { name: "Cancelar" }));
    expect(cuerpos).toEqual([]);

    await usuario.click(screen.getByRole("button", { name: "Desactivar acopiador" }));
    await usuario.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Desactivar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(cuerpos).toEqual([{ activo: false }]);
    expect(screen.getByRole("button", { name: "Reactivar acopiador" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generar código de activación" })).toBeDisabled();
  });

  it("reactivar avisa que su celular pudo desvincularse si intentó entrar estando inactivo", async () => {
    simular(acopiador({ activo: false }));
    renderizar("/acopiadores/7");

    await userEvent.setup().click(await screen.findByRole("button", { name: "Reactivar acopiador" }));
    const ventana = screen.getByRole("dialog", { name: "Reactivar acopiador" });
    expect(ventana).toHaveTextContent("Vuelve a poder entrar y sincronizar.");
    expect(ventana).toHaveTextContent(
      "Si mientras estuvo inactivo intentó entrar con señal, su celular quedó desvinculado: genere un código nuevo " +
      "y actívelo en ese mismo celular (conserva lo que tenga sin enviar).");
  });

  describe("aviso de 'Acopiador creado'", () => {
    const AVISO = /Acopiador creado\. Está pendiente de activar/;
    const nuevo = (cambios: Partial<Acopiador> = {}) =>
      acopiador({ pin_pendiente: true, celular_vinculado: false, ...cambios });

    function abrirRecienCreado(a: Acopiador) {
      simular(a);
      servidor.use(http.post(`${API}/usuarios/7/codigo-activacion`, () =>
        HttpResponse.json({ codigo: "K7QM2XWP", expira_en: "2026-10-18T16:05:00Z" }, { status: 201 })));
      renderizar({ pathname: "/acopiadores/7", state: { creado: true } });
    }

    async function confirmar(usuario: ReturnType<typeof userEvent.setup>, boton: string) {
      await usuario.click(within(screen.getByRole("dialog")).getByRole("button", { name: boton }));
    }

    it.each([
      ["guardar", async (u: ReturnType<typeof userEvent.setup>) => {
        await u.clear(screen.getByLabelText("Celular"));
        await u.type(screen.getByLabelText("Celular"), "999888777");
        await u.click(screen.getByRole("button", { name: "Guardar cambios" }));
      }],
      ["guardar sin cambios", async (u: ReturnType<typeof userEvent.setup>) => {
        await u.click(screen.getByRole("button", { name: "Guardar cambios" }));
      }],
      ["desactivar", async (u: ReturnType<typeof userEvent.setup>) => {
        await u.click(screen.getByRole("button", { name: "Desactivar acopiador" }));
        await confirmar(u, "Desactivar");
      }],
      ["generar código", async (u: ReturnType<typeof userEvent.setup>) => {
        await u.click(screen.getByRole("button", { name: "Generar código de activación" }));
        await confirmar(u, "Generar código");
      }],
    ])("desaparece después de %s y no vuelve con F5", async (_accion, hacer) => {
      abrirRecienCreado(nuevo());
      const usuario = userEvent.setup();
      expect(await screen.findByText(AVISO)).toBeInTheDocument();

      await hacer(usuario);
      await waitFor(() => expect(screen.queryByText(AVISO)).not.toBeInTheDocument());
      expect(estadoHistorial()).toBeNull();
      expect(ubicacion()).toBe("/acopiadores/7");
    });

    it("desaparece después de reactivar", async () => {
      abrirRecienCreado(nuevo({ activo: false }));
      const usuario = userEvent.setup();
      expect(await screen.findByText(AVISO)).toBeInTheDocument();

      await usuario.click(screen.getByRole("button", { name: "Reactivar acopiador" }));
      await confirmar(usuario, "Reactivar");
      await waitFor(() => expect(screen.queryByText(AVISO)).not.toBeInTheDocument());
      expect(estadoHistorial()).toBeNull();
    });

    it("cancelar una confirmación no lo quita", async () => {
      abrirRecienCreado(nuevo());
      const usuario = userEvent.setup();
      await screen.findByText(AVISO);

      await usuario.click(screen.getByRole("button", { name: "Desactivar acopiador" }));
      await confirmar(usuario, "Cancelar");
      expect(screen.getByText(AVISO)).toBeInTheDocument();
    });
  });

  it("sin rutas avisa que su celular no verá productores", async () => {
    simular(acopiador({ rutas: [] }));
    renderizar("/acopiadores/7");
    expect(await screen.findByText(/Sin rutas asignadas, su celular no verá productores/)).toBeInTheDocument();
  });

  it("un acopiador que no existe: mensaje del servidor", async () => {
    servidor.use(http.get(`${API}/acopiadores/999`, () =>
      HttpResponse.json({ codigo: "no_encontrado", mensaje: "El acopiador no existe" }, { status: 404 })));
    renderizar("/acopiadores/999");
    expect(await screen.findByRole("alert")).toHaveTextContent("El acopiador no existe");
  });

  it("un id que no es número no llama a la API", async () => {
    const llamada = vi.fn();
    servidor.use(http.get(`${API}/acopiadores/:id`, () => {
      llamada();
      return HttpResponse.json(acopiador());
    }));
    renderizar("/acopiadores/abc");
    expect(await screen.findByRole("alert")).toHaveTextContent("El acopiador no existe");
    expect(llamada).not.toHaveBeenCalled();
  });
});
