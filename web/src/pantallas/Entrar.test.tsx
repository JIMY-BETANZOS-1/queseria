import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CLAVE, contiene, espiarConsola, respuestaLogin } from "../pruebas/datos";
import { renderizar, ubicacion } from "../pruebas/renderizar";
import { API, servidor } from "../pruebas/servidor";
import { cerrarSesion, guardarSesion } from "../sesion/almacen";

const CORREO = "admin@queseria.test";

afterEach(() => {
  vi.restoreAllMocks();
});

function loginResponde(respuesta: () => Response | Promise<Response>) {
  const llamadas = vi.fn();
  servidor.use(http.post(`${API}/auth/admin/login`, () => {
    llamadas();
    return respuesta();
  }));
  return llamadas;
}

async function llenarYEnviar(correo = CORREO, clave = CLAVE) {
  const usuario = userEvent.setup();
  if (correo) await usuario.type(screen.getByLabelText("Correo"), correo);
  if (clave) await usuario.type(screen.getByLabelText("Contraseña"), clave);
  await usuario.click(screen.getByRole("button", { name: "Entrar" }));
}

describe("Entrar", () => {
  it("con datos correctos entra y vuelve a la pantalla de ?volver=", async () => {
    loginResponde(() => HttpResponse.json(respuestaLogin()));
    renderizar("/entrar?volver=%2Facopiadores%3Ffecha%3D2026-10-18");

    await llenarYEnviar();
    await waitFor(() => expect(ubicacion()).toBe("/acopiadores?fecha=2026-10-18"));
    expect(document.title).toBe("Página no encontrada · Quesería Huata");   // esa pantalla aún no existe
  });

  it.each(["//sitio-ajeno.example", "/\\sitio-ajeno.example", "https://sitio-ajeno.example"])(
    "con ?volver=%s inseguro va a Inicio", async (volver) => {
      loginResponde(() => HttpResponse.json(respuestaLogin()));
      renderizar(`/entrar?volver=${encodeURIComponent(volver)}`);

      await llenarYEnviar();
      await waitFor(() => expect(ubicacion()).toBe("/"));
      expect(await screen.findByText("Bienvenido, Administrador de Prueba")).toBeInTheDocument();
    });

  it("401: muestra el mensaje del servidor, conserva el correo y vacía la contraseña", async () => {
    loginResponde(() =>
      HttpResponse.json({ codigo: "no_autorizado", mensaje: "Correo o contraseña incorrectos" }, { status: 401 }));
    renderizar("/entrar");

    await llenarYEnviar();
    expect(await screen.findByRole("alert")).toHaveTextContent("Correo o contraseña incorrectos");
    expect(screen.getByLabelText("Correo")).toHaveValue(CORREO);
    expect(screen.getByLabelText("Contraseña")).toHaveValue("");
    expect(ubicacion()).toBe("/entrar");
  });

  it("429: muestra el mensaje del servidor", async () => {
    loginResponde(() => HttpResponse.json(
      { codigo: "demasiados_intentos", mensaje: "Demasiados intentos fallidos. Intente en unos minutos" }, { status: 429 }));
    renderizar("/entrar");

    await llenarYEnviar();
    expect(await screen.findByRole("alert")).toHaveTextContent("Demasiados intentos fallidos. Intente en unos minutos");
  });

  it("sin conexión: lo dice", async () => {
    loginResponde(() => HttpResponse.error());
    renderizar("/entrar");

    await llenarYEnviar();
    expect(await screen.findByRole("alert")).toHaveTextContent(`No se pudo conectar con la API (${API})`);
  });

  it("mientras envía, el botón queda desactivado (no se envía dos veces)", async () => {
    const control: { responder?: () => void } = {};
    const llamadas = loginResponde(() => new Promise<Response>((listo) => {
      control.responder = () => listo(HttpResponse.json(respuestaLogin()));
    }));
    renderizar("/entrar");

    await llenarYEnviar();
    const boton = await screen.findByRole("button", { name: "Entrando…" });
    expect(boton).toBeDisabled();
    await userEvent.setup().click(boton);
    expect(llamadas).toHaveBeenCalledTimes(1);

    control.responder?.();
    await waitFor(() => expect(ubicacion()).toBe("/"));
  });

  it("con campos vacíos no envía nada y lo dice bajo cada campo", async () => {
    const llamadas = loginResponde(() => HttpResponse.json(respuestaLogin()));
    renderizar("/entrar");

    await llenarYEnviar("", "");
    expect(screen.getByText("Escriba su correo")).toBeInTheDocument();
    expect(screen.getByText("Escriba su contraseña")).toBeInTheDocument();
    expect(screen.getByLabelText("Correo")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Correo")).toHaveAccessibleDescription("Escriba su correo");
    expect(llamadas).not.toHaveBeenCalled();
  });

  it("si la sesión venció, avisa", () => {
    guardarSesion(respuestaLogin());
    cerrarSesion("vencida");
    renderizar("/entrar");

    expect(screen.getByRole("status")).toHaveTextContent("Su sesión venció. Vuelva a entrar.");
  });

  it("si salió con Salir, no avisa de vencimiento", () => {
    guardarSesion(respuestaLogin());
    cerrarSesion("salida");
    renderizar("/entrar");

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("con sesión vigente, /entrar lleva directo a ?volver=", () => {
    guardarSesion(respuestaLogin());
    renderizar("/entrar?volver=%2Fotra");

    expect(ubicacion()).toBe("/otra");
  });

  it("la contraseña no queda en la URL, el almacenamiento, la página ni la consola", async () => {
    const consola = espiarConsola();
    loginResponde(() =>
      HttpResponse.json({ codigo: "no_autorizado", mensaje: "Correo o contraseña incorrectos" }, { status: 401 }));
    renderizar("/entrar");

    await llenarYEnviar();
    await screen.findByRole("alert");
    const almacenado = JSON.stringify({ ...window.sessionStorage }) + JSON.stringify({ ...window.localStorage });
    const filtrada = [ubicacion(), almacenado, document.body.innerHTML, document.title].some((t) => contiene(t, CLAVE));
    expect(filtrada).toBe(false);
    expect(consola.mostro(CLAVE)).toBe(false);
  });
});
