// Renderiza el panel completo en una ruta, con un MemoryRouter, y muestra la ubicación actual para poder
// comprobar las redirecciones (?volver=…).
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, useLocation } from "react-router-dom";

import App from "../App";
import { API, servidor } from "./servidor";

function Ubicacion() {
  const { pathname, search, state } = useLocation();
  // <span> y no <output>: <output> tiene el rol "status" y se confundiría con los avisos
  return <span data-testid="ubicacion" data-estado={JSON.stringify(state ?? null)}>{pathname + search}</span>;
}

/** `ruta` puede llevar el `state` del historial (por ejemplo { creado: true } al venir de "Nuevo acopiador"). */
export function renderizar(ruta: string | { pathname: string; state: unknown }, { apiCaida = false } = {}) {
  // Inicio consulta /salud al abrirse
  servidor.use(http.get(`${API}/salud`, () => apiCaida
    ? HttpResponse.error()
    : HttpResponse.json({ estado: "ok", base: "queseria_prueba", hora: "2026-10-18T10:00:00-05:00" })));
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <App />
      <Ubicacion />
    </MemoryRouter>,
  );
}

export function ubicacion(): string {
  return screen.getByTestId("ubicacion").textContent ?? "";
}

/** `state` del historial en la ubicación actual (lo que vería la pantalla tras un F5). */
export function estadoHistorial(): unknown {
  return JSON.parse(screen.getByTestId("ubicacion").getAttribute("data-estado") ?? "null");
}
