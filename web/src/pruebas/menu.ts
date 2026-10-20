import { screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

/**
 * Navega por el menú como una persona: despliega el grupo si está plegado (solo el de la pantalla actual arranca
 * abierto) y pulsa el enlace.
 */
export async function irPorMenu(usuario: UserEvent, grupo: string, enlace: string) {
  const menu = screen.getByRole("navigation", { name: "Menú principal" });
  const boton = within(menu).getByRole("button", { name: grupo });
  if (boton.getAttribute("aria-expanded") !== "true") await usuario.click(boton);
  await usuario.click(within(within(menu).getByRole("list", { name: grupo })).getByRole("link", { name: enlace }));
}
