import { describe, expect, it } from "vitest";

import { fecha, fechaHoraLima, horaLima, soles } from "./formato";

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

  it("acepta el texto ISO 8601 con zona que devuelve la API", () => {
    expect(horaLima("2026-10-18T11:05:00-05:00")).toBe("11:05");
    expect(horaLima("2026-10-18T16:05:00.123Z")).toBe("11:05");
  });
});

describe("fechaHoraLima", () => {
  it("las 23:30 de Lima siguen siendo del mismo día aunque en UTC ya sea el siguiente", () => {
    expect(fechaHoraLima("2026-10-19T04:30:00Z")).toBe("18/10/2026 23:30");
  });
});

describe("fecha (tipo date de la API)", () => {
  it("no se corre un día por la zona horaria", () => {
    expect(fecha("2026-10-18")).toBe("18/10/2026");
  });
});

describe("soles", () => {
  it("2 decimales por defecto", () => {
    expect(soles(900)).toBe("S/ 900.00");
    expect(soles(1234.5)).toBe("S/ 1,234.50");
  });

  it("decimales indicados (comisión por litro)", () => {
    expect(soles(0.05, 3)).toBe("S/ 0.050");
  });
});
