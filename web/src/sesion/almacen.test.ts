import { afterEach, describe, expect, it, vi } from "vitest";

import { contiene, respuestaLogin, TOKEN, TOKEN_OTRO } from "../pruebas/datos";
import {
  cerrarSesion, guardarSesion, MARGEN_MS, motivoCierre, sesionGuardada, sesionVigente, suscribir,
  vigilarVencimiento,
} from "./almacen";

const CLAVE = "queseria.sesion";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("guardar y leer", () => {
  it("guarda en sessionStorage (nunca en localStorage) con la hora de vencimiento", () => {
    const ahora = Date.UTC(2026, 9, 18, 15, 0, 0);
    const sesion = guardarSesion(respuestaLogin(TOKEN, 30), ahora);

    expect(sesion.vence_en).toBe(ahora + 30 * 60_000 - MARGEN_MS);
    expect(sesion.usuario.nombre_completo).toBe("Administrador de Prueba");
    expect(sesion.token === TOKEN).toBe(true);
    expect(contiene(window.sessionStorage.getItem(CLAVE), TOKEN)).toBe(true);
    expect(window.localStorage.length).toBe(0);
  });

  it("sobrevive a una recarga: se lee de sessionStorage", () => {
    guardarSesion(respuestaLogin());
    const crudo = window.sessionStorage.getItem(CLAVE);
    window.sessionStorage.clear();
    expect(sesionGuardada()).toBeNull();

    window.sessionStorage.setItem(CLAVE, crudo!);
    expect(sesionVigente()?.usuario.id).toBe(1);
  });

  it("devuelve el mismo objeto mientras no cambia (useSyncExternalStore)", () => {
    guardarSesion(respuestaLogin());
    expect(sesionGuardada()).toBe(sesionGuardada());
  });

  it("un JSON dañado se descarta y se borra", () => {
    window.sessionStorage.setItem(CLAVE, "{no es json");
    expect(sesionGuardada()).toBeNull();
    expect(window.sessionStorage.getItem(CLAVE)).toBeNull();
  });

  it("una sesión con datos incompletos se descarta", () => {
    window.sessionStorage.setItem(CLAVE, JSON.stringify({ token: "x", vence_en: "mañana" }));
    expect(sesionGuardada()).toBeNull();
    expect(window.sessionStorage.getItem(CLAVE)).toBeNull();
  });

  it("si sessionStorage lanza error, sin sesión al leer y la sesión vive solo en memoria", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("almacenamiento bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("almacenamiento bloqueado");
    });
    expect(sesionGuardada()).toBeNull();

    guardarSesion(respuestaLogin());
    expect(sesionVigente()?.usuario.id).toBe(1);
  });

  it("una sesión vencida queda guardada pero no vigente", () => {
    const ahora = Date.now();
    guardarSesion(respuestaLogin(TOKEN, 30), ahora);
    expect(sesionVigente(ahora + 30 * 60_000 - MARGEN_MS)).toBeNull();
    expect(sesionGuardada()).not.toBeNull();
  });
});

describe("cerrar", () => {
  it("salir deja motivo 'salida' y volver a entrar lo olvida", () => {
    guardarSesion(respuestaLogin());
    expect(cerrarSesion("salida")).toBe(true);
    expect(sesionGuardada()).toBeNull();
    expect(motivoCierre()).toBe("salida");

    guardarSesion(respuestaLogin());
    expect(motivoCierre()).toBeNull();
  });

  it("cerrar dos veces avisa una sola vez", () => {
    guardarSesion(respuestaLogin());
    const oyente = vi.fn();
    suscribir(oyente);

    expect(cerrarSesion("vencida")).toBe(true);
    expect(cerrarSesion("vencida")).toBe(false);
    expect(oyente).toHaveBeenCalledTimes(1);
  });

  it("con soloSiToken no cierra una sesión distinta", () => {
    guardarSesion(respuestaLogin(TOKEN_OTRO));
    expect(cerrarSesion("vencida", TOKEN)).toBe(false);
    expect(sesionVigente()).not.toBeNull();
  });
});

describe("vencimiento", () => {
  it("el temporizador cierra la sesión a la hora exacta", () => {
    vi.useFakeTimers();
    guardarSesion(respuestaLogin(TOKEN, 1));          // 60 s - 30 s de margen = 30 s
    const oyente = vi.fn();
    suscribir(oyente);

    vi.advanceTimersByTime(60_000 - MARGEN_MS - 1);
    expect(sesionGuardada()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(sesionGuardada()).toBeNull();
    expect(motivoCierre()).toBe("vencida");
    expect(oyente).toHaveBeenCalledTimes(1);
  });

  it("al volver a la pestaña (laptop suspendida) cierra la sesión vencida", () => {
    vi.useFakeTimers({ toFake: ["Date"] });               // el temporizador no corre, como en suspensión
    guardarSesion(respuestaLogin(TOKEN, 30));
    const dejar = vigilarVencimiento();
    expect(sesionGuardada()).not.toBeNull();

    vi.setSystemTime(Date.now() + 31 * 60_000);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(sesionGuardada()).toBeNull();
    expect(motivoCierre()).toBe("vencida");
    dejar();
  });
});
