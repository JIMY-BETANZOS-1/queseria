import { describe, expect, it } from "vitest";

import { reglaCelular, reglaDni, reglaDocumento, reglaNombre } from "./reglas";

describe("reglas de usuario móvil (= CHECK de la tabla usuario)", () => {
  it("nombre: obligatorio, sin contar espacios", () => {
    expect(reglaNombre("Ana")).toBeUndefined();
    expect(reglaNombre("   ")).toBe("Escriba el nombre completo");
  });

  it.each(["41234567", " 41234567 "])("DNI válido: %j", (dni) => {
    expect(reglaDni(dni)).toBeUndefined();
  });

  it.each(["", "1234567", "123456789", "4123456a", "41.23456"])("DNI inválido: %j (ck_usuario_dni: 8 dígitos)", (dni) => {
    expect(reglaDni(dni)).toBe("El DNI debe tener 8 dígitos");
  });

  it.each(["951234567", " 951234567 "])("celular válido: %j", (celular) => {
    expect(reglaCelular(celular)).toBeUndefined();
  });

  it.each(["", "95123456", "9512345678", "95123456x", "+51951234"])(
    "celular inválido: %j (ck_usuario_celular: 9 dígitos)", (celular) => {
      expect(reglaCelular(celular)).toBe("El celular debe tener 9 dígitos");
    });

  it.each(["41234567", "20123456789", " 20123456789 "])("documento de productor válido (DNI o RUC): %j", (doc) => {
    expect(reglaDocumento(doc)).toBeUndefined();
  });

  it.each(["", "1234567", "123456789", "1234567890", "201234567890", "2012345678a"])(
    "documento de productor inválido: %j (ck_productor_documento: 8 u 11 dígitos)", (doc) => {
      expect(reglaDocumento(doc)).toBe("El documento debe ser un DNI (8 dígitos) o RUC (11 dígitos)");
    });
});
