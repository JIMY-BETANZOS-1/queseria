import { describe, expect, it } from "vitest";

import { rutaVolver } from "./volver";

describe("rutaVolver", () => {
  it.each(["/", "/acopiadores", "/acopiadores/12", "/recolecciones?fecha=2026-10-18&acopiador=3"])(
    "acepta la ruta interna %s", (ruta) => {
      expect(rutaVolver(ruta)).toBe(ruta);
    });

  it.each([
    ["//sitio-ajeno.example", "doble barra"],
    ["//sitio-ajeno.example/acopiadores", "doble barra con ruta"],
    ["/\\sitio-ajeno.example", "barra y barra invertida"],
    ["\\\\sitio-ajeno.example", "barras invertidas"],
    ["\\sitio-ajeno.example", "barra invertida inicial"],
    ["/acopiadores\\..\\x", "barra invertida en medio"],
    ["https://sitio-ajeno.example", "URL absoluta"],
    ["javascript:alert(1)", "esquema javascript"],
    ["acopiadores", "ruta relativa"],
    ["/ /sitio-ajeno.example", "espacio"],
    ["/\t/sitio-ajeno.example", "tabulador"],
    ["/acopiadores\n", "salto de línea"],
    ["", "vacío"],
  ])("rechaza %s (%s) y usa la de inicio", (ruta) => {
    expect(rutaVolver(ruta)).toBe("/");
  });

  it("sin valor usa la de inicio o la indicada", () => {
    expect(rutaVolver(null)).toBe("/");
    expect(rutaVolver(undefined, "/alertas")).toBe("/alertas");
  });
});
