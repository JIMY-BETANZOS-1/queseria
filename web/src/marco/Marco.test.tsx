import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ErrorSesion, pedir } from "../api/cliente";
import { respuestaLogin } from "../pruebas/datos";
import { renderizar, ubicacion } from "../pruebas/renderizar";
import { API, servidor } from "../pruebas/servidor";
import { guardarSesion } from "../sesion/almacen";

afterEach(() => {
  vi.useRealTimers();
});

describe("protección de rutas", () => {
  it("sin sesión lleva a Entrar con ?volver= (ruta y consulta codificadas)", () => {
    renderizar("/acopiadores?fecha=2026-10-18&ruta=3");

    expect(ubicacion()).toBe("/entrar?volver=%2Facopiadores%3Ffecha%3D2026-10-18%26ruta%3D3");
    expect(screen.getByRole("button", { name: "Entrar" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();   // nunca entró: no hay "sesión venció"
  });

  it("un 401 en una pantalla cierra la sesión y lleva a Entrar con el aviso y ?volver=", async () => {
    guardarSesion(respuestaLogin());
    servidor.use(http.get(`${API}/rutas`, () =>
      HttpResponse.json({ codigo: "no_autorizado", mensaje: "Sesión inválida o vencida" }, { status: 401 })));
    renderizar("/");
    expect(await screen.findByText("Bienvenido, Administrador de Prueba")).toBeInTheDocument();

    await act(async () => {
      await expect(pedir("GET", "/rutas")).rejects.toBeInstanceOf(ErrorSesion);
    });
    await waitFor(() => expect(ubicacion()).toBe("/entrar?volver=%2F"));
    expect(screen.getByRole("status")).toHaveTextContent("Su sesión venció. Vuelva a entrar.");
  });

  it("Salir lleva a Entrar sin aviso y sin ?volver=", async () => {
    guardarSesion(respuestaLogin());
    renderizar("/");

    await userEvent.setup().click(await screen.findByRole("button", { name: "Salir" }));
    await waitFor(() => expect(ubicacion()).toBe("/entrar"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("al vencer la sesión con la pantalla abierta, lleva a Entrar con el aviso", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    guardarSesion(respuestaLogin(undefined, 1));          // vence en 30 s (60 s − margen)
    renderizar("/");
    expect(screen.getByRole("button", { name: "Salir" })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(ubicacion()).toBe("/entrar?volver=%2F");
    expect(screen.getByRole("status")).toHaveTextContent("Su sesión venció. Vuelva a entrar.");
  });
});

describe("marco", () => {
  it("muestra el nombre del admin y la hora de vencimiento en hora de Lima", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 9, 18, 15, 0, 0));    // 10:00 en Lima
    guardarSesion(respuestaLogin(undefined, 30));        // vence 10:29:30 Lima (30 min − 30 s)
    renderizar("/");

    expect(screen.getByText("Administrador de Prueba")).toBeInTheDocument();
    expect(screen.getByText("Sesión hasta las 10:29")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Menú principal" })).toHaveTextContent("Inicio");
  });

  it("Inicio muestra la API conectada y el título de la pestaña", async () => {
    guardarSesion(respuestaLogin());
    renderizar("/");

    expect(await screen.findByText(/API conectada/)).toHaveTextContent("API conectada · base queseria_prueba");
    expect(document.title).toBe("Inicio · Quesería Huata");
  });

  it("Inicio avisa si la API no responde", async () => {
    guardarSesion(respuestaLogin());
    renderizar("/", { apiCaida: true });

    expect(await screen.findByText(`No se pudo conectar con la API (${API})`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salir" })).toBeInTheDocument();   // /salud no cierra la sesión
  });

  it("una ruta desconocida muestra 'Página no encontrada' dentro del marco", () => {
    guardarSesion(respuestaLogin());
    renderizar("/no-existe");

    expect(screen.getByRole("heading", { name: "Página no encontrada" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver a Inicio" })).toHaveAttribute("href", "/");
  });
});
