import { describe, expect, it } from "vitest";

import { horaLima } from "./formato";

describe("horaLima", () => {
  it("convierte a hora de Lima (UTC−5) sin importar la zona del PC", () => {
    const instante = Date.UTC(2026, 9, 18, 15, 0, 0);
    // Las pruebas corren con TZ=Asia/Tokyo (vite.config.ts): la hora local del proceso NO es la de Lima
    expect(new Date(instante).getHours()).toBe(0);
    expect(horaLima(instante)).toBe("10:00");
  });

  it("formato de 24 horas, con cero a la izquierda", () => {
    expect(horaLima(Date.UTC(2026, 9, 18, 13, 5))).toBe("08:05");
    expect(horaLima(Date.UTC(2026, 9, 19, 4, 30))).toBe("23:30");   // 23:30 Lima = 04:30 UTC del día siguiente
  });
});
