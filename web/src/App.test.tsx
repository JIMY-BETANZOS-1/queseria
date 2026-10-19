import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App (esqueleto)", () => {
  it("muestra la base cuando /salud responde", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ estado: "ok", base: "queseria", hora: "2026-10-18T10:00:00-05:00" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchFalso);

    render(<App />);

    expect(await screen.findByText(/API conectada/)).toBeInTheDocument();
    expect(screen.getByText("queseria")).toBeInTheDocument();
    expect(fetchFalso).toHaveBeenCalledWith("http://api.prueba/salud");
  });

  it("avisa si la API no responde", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    render(<App />);

    expect(await screen.findByText(/No se pudo conectar con la API/)).toBeInTheDocument();
  });
});
