// Datos ficticios para las pruebas. Las pruebas nunca pasan TOKEN ni CLAVE a expect(...) ni a un nombre de
// prueba: se comparan con contiene()/igual() y se afirma el booleano, para que ni un fallo los imprima.
import { vi } from "vitest";

import type { Token } from "../api/tipos";

export const TOKEN = "tok.prueba.ficticio-0001";
export const TOKEN_OTRO = "tok.prueba.ficticio-0002";
export const CLAVE = "clave-ficticia-de-prueba";

export function respuestaLogin(token = TOKEN, expiraEnMin = 30): Token {
  return {
    access_token: token,
    token_type: "bearer",
    expira_en_min: expiraEnMin,
    usuario: { id: 1, rol: "admin", nombre_completo: "Administrador de Prueba" },
  };
}

export function contiene(texto: unknown, secreto: string): boolean {
  return JSON.stringify(texto ?? "").includes(secreto) || String(texto).includes(secreto);
}

/** Silencia y espía la consola; dice cuántas llamadas hubo y si alguna incluyó un secreto (sin imprimirlo). */
export function espiarConsola() {
  const espias = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => undefined));
  return {
    llamadas: () => espias.reduce((n, e) => n + e.mock.calls.length, 0),
    mostro: (secreto: string) => espias.some((e) => e.mock.calls.some((args) => contiene(args, secreto))),
  };
}
