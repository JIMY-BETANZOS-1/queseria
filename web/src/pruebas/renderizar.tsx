// Renderiza el panel completo en una ruta, con un MemoryRouter, y muestra la ubicación actual para poder
// comprobar las redirecciones (?volver=…).
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, useLocation } from "react-router-dom";

import App from "../App";
import { API, servidor } from "./servidor";

function Ubicacion() {
  const { pathname, search } = useLocation();
  // <span> y no <output>: <output> tiene el rol "status" y se confundiría con los avisos
  return <span data-testid="ubicacion">{pathname + search}</span>;
}

export function renderizar(ruta: string, { apiCaida = false } = {}) {
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
