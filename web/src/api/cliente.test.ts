import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CLAVE, contiene, espiarConsola, respuestaLogin, TOKEN, TOKEN_OTRO } from "../pruebas/datos";
import { API, servidor } from "../pruebas/servidor";
import { guardarSesion, motivoCierre, sesionGuardada, sesionVigente, suscribir } from "../sesion/almacen";
import { entrar, ErrorApi, ErrorSesion, pedir, salir } from "./cliente";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Ejecuta la promesa y devuelve el error que lanzó (falla si no lanzó). */
async function errorDe(promesa: Promise<unknown>): Promise<ErrorApi> {
  try {
    await promesa;
  } catch (e) {
    if (e instanceof ErrorApi) return e;
    throw e;
  }
  throw new Error("Se esperaba un error");
}

describe("cabeceras", () => {
  it("con sesión agrega Authorization: Bearer <token>", async () => {
    guardarSesion(respuestaLogin(TOKEN));
    let autorizacion: string | null = null;
    servidor.use(http.get(`${API}/acopiadores`, ({ request }) => {
      autorizacion = request.headers.get("Authorization");
      return HttpResponse.json([]);
    }));

    await pedir("GET", "/acopiadores");
    expect(autorizacion === `Bearer ${TOKEN}`).toBe(true);
  });

  it("el login no lleva Authorization y manda JSON", async () => {
    let autorizacion: string | null = "sin leer";
    let tipo: string | null = null;
    let cuerpo: { email?: string; password?: string } = {};
    servidor.use(http.post(`${API}/auth/admin/login`, async ({ request }) => {
      autorizacion = request.headers.get("Authorization");
      tipo = request.headers.get("Content-Type");
      cuerpo = (await request.json()) as typeof cuerpo;
      return HttpResponse.json(respuestaLogin());
    }));

    const sesion = await entrar("admin@queseria.test", CLAVE);
    expect(autorizacion).toBeNull();
    expect(tipo).toBe("application/json");
    expect(cuerpo.email).toBe("admin@queseria.test");
    expect(cuerpo.password === CLAVE).toBe(true);
    expect(sesion.usuario.nombre_completo).toBe("Administrador de Prueba");
    expect(sesionVigente()).not.toBeNull();
  });

  it("los parámetros de consulta vacíos no se envían", async () => {
    guardarSesion(respuestaLogin());
    let url = "";
    servidor.use(http.get(`${API}/recolecciones`, ({ request }) => {
      url = request.url;
      return HttpResponse.json([]);
    }));

    await pedir("GET", "/recolecciones", { consulta: { desde: "2026-10-18", registrado_por: null, ruta_id: undefined } });
    expect(new URL(url).search).toBe("?desde=2026-10-18");
  });
});

describe("401", () => {
  it("en el login es contraseña incorrecta: mensaje del servidor y no cierra nada", async () => {
    servidor.use(http.post(`${API}/auth/admin/login`, () =>
      HttpResponse.json({ codigo: "no_autorizado", mensaje: "Correo o contraseña incorrectos" }, { status: 401 })));
    const oyente = vi.fn();
    suscribir(oyente);

    const e = await errorDe(entrar("admin@queseria.test", CLAVE));
    expect(e).not.toBeInstanceOf(ErrorSesion);
    expect(e.status).toBe(401);
    expect(e.message).toBe("Correo o contraseña incorrectos");
    expect(oyente).not.toHaveBeenCalled();
    expect(motivoCierre()).toBeNull();
  });

  it("en otra ruta cierra la sesión con motivo 'vencida' y lanza ErrorSesion", async () => {
    guardarSesion(respuestaLogin());
    servidor.use(http.get(`${API}/alertas`, () =>
      HttpResponse.json({ codigo: "no_autorizado", mensaje: "Sesión inválida o vencida" }, { status: 401 })));

    const e = await errorDe(pedir("GET", "/alertas"));
    expect(e).toBeInstanceOf(ErrorSesion);
    expect(sesionGuardada()).toBeNull();
    expect(motivoCierre()).toBe("vencida");
  });

  it("tres 401 a la vez avisan una sola vez", async () => {
    guardarSesion(respuestaLogin());
    servidor.use(http.get(`${API}/:ruta`, () =>
      HttpResponse.json({ codigo: "no_autorizado", mensaje: "Sesión inválida o vencida" }, { status: 401 })));
    const oyente = vi.fn();
    suscribir(oyente);

    const errores = await Promise.allSettled([pedir("GET", "/acopiadores"), pedir("GET", "/analistas"), pedir("GET", "/rutas")]);
    expect(errores.every((r) => r.status === "rejected" && r.reason instanceof ErrorSesion)).toBe(true);
    expect(oyente).toHaveBeenCalledTimes(1);
  });

  it("un 401 tardío de la sesión anterior no cierra la sesión nueva", async () => {
    guardarSesion(respuestaLogin(TOKEN));
    const control: { responder?: () => void } = {};
    const llego = new Promise<void>((avisar) => {
      servidor.use(http.get(`${API}/rutas`, () => new Promise<Response>((listo) => {
        control.responder = () => listo(HttpResponse.json({ codigo: "no_autorizado", mensaje: "x" }, { status: 401 }));
        avisar();
      })));
    });

    const pendiente = pedir("GET", "/rutas");
    await llego;                                           // la petición ya salió con el token anterior
    guardarSesion(respuestaLogin(TOKEN_OTRO));            // el admin volvió a entrar mientras tanto
    control.responder?.();

    expect(await errorDe(pendiente)).toBeInstanceOf(ErrorSesion);
    expect(sesionVigente()?.token === TOKEN_OTRO).toBe(true);
  });
});

describe("otros errores", () => {
  it("403 no cierra la sesión", async () => {
    guardarSesion(respuestaLogin());
    servidor.use(http.get(`${API}/acopiadores`, () =>
      HttpResponse.json({ codigo: "prohibido", mensaje: "No tiene permiso para esta operación" }, { status: 403 })));

    const e = await errorDe(pedir("GET", "/acopiadores"));
    expect([e.status, e.codigo, e.message]).toEqual([403, "prohibido", "No tiene permiso para esta operación"]);
    expect(sesionVigente()).not.toBeNull();
  });

  it("422 trae los errores por campo", async () => {
    guardarSesion(respuestaLogin());
    servidor.use(http.post(`${API}/acopiadores`, () => HttpResponse.json({
      codigo: "validacion", mensaje: "Datos inválidos",
      errores: [{ campo: "dni", mensaje: "Campo obligatorio" }, { campo: "color_hex", mensaje: "Debe ser texto" }],
    }, { status: 422 })));

    const e = await errorDe(pedir("POST", "/acopiadores", { cuerpo: {} }));
    expect(e.codigo).toBe("validacion");
    expect(e.errores).toEqual([{ campo: "dni", mensaje: "Campo obligatorio" }, { campo: "color_hex", mensaje: "Debe ser texto" }]);
  });

  it("409 trae el mensaje de la base", async () => {
    guardarSesion(respuestaLogin());
    servidor.use(http.post(`${API}/acopiadores`, () =>
      HttpResponse.json({ codigo: "conflicto", mensaje: "Ya existe un usuario con ese DNI" }, { status: 409 })));

    const e = await errorDe(pedir("POST", "/acopiadores", { cuerpo: {} }));
    expect([e.status, e.message]).toEqual([409, "Ya existe un usuario con ese DNI"]);
    expect(e.errores).toEqual([]);
  });

  it("429 del login trae el mensaje del servidor", async () => {
    servidor.use(http.post(`${API}/auth/admin/login`, () => HttpResponse.json(
      { codigo: "demasiados_intentos", mensaje: "Demasiados intentos fallidos. Intente en unos minutos" }, { status: 429 })));

    const e = await errorDe(entrar("admin@queseria.test", CLAVE));
    expect([e.status, e.codigo]).toEqual([429, "demasiados_intentos"]);
  });

  it("sin red: mensaje de conexión", async () => {
    guardarSesion(respuestaLogin());
    servidor.use(http.get(`${API}/rutas`, () => HttpResponse.error()));

    const e = await errorDe(pedir("GET", "/rutas"));
    expect([e.status, e.codigo, e.message]).toEqual([0, "sin_conexion", `No se pudo conectar con la API (${API})`]);
  });

  it("500 sin JSON: 'Error del servidor (500)'", async () => {
    guardarSesion(respuestaLogin());
    servidor.use(http.get(`${API}/rutas`, () => new HttpResponse("Internal Server Error", { status: 500 })));

    const e = await errorDe(pedir("GET", "/rutas"));
    expect(e.message).toBe("Error del servidor (500)");
  });

  it("204 devuelve undefined", async () => {
    guardarSesion(respuestaLogin());
    servidor.use(http.delete(`${API}/rutas/1/acopiador`, () => new HttpResponse(null, { status: 204 })));

    expect(await pedir("DELETE", "/rutas/1/acopiador")).toBeUndefined();
  });
});

describe("sesión vencida o ausente", () => {
  it("una sesión vencida no envía la petición", async () => {
    guardarSesion(respuestaLogin(TOKEN, 30), Date.now() - 31 * 60_000);
    const llamada = vi.fn();
    servidor.use(http.get(`${API}/rutas`, () => {
      llamada();
      return HttpResponse.json([]);
    }));

    expect(await errorDe(pedir("GET", "/rutas"))).toBeInstanceOf(ErrorSesion);
    expect(llamada).not.toHaveBeenCalled();
    expect(motivoCierre()).toBe("vencida");
  });

  it("sin haber entrado no envía nada ni deja motivo", async () => {
    expect(await errorDe(pedir("GET", "/rutas"))).toBeInstanceOf(ErrorSesion);
    expect(motivoCierre()).toBeNull();
  });

  it("salir borra la sesión con motivo 'salida'", () => {
    guardarSesion(respuestaLogin());
    salir();
    expect(sesionGuardada()).toBeNull();
    expect(motivoCierre()).toBe("salida");
  });
});

describe("secretos", () => {
  it("ni el token ni la contraseña aparecen en errores ni en la consola", async () => {
    const consola = espiarConsola();
    const respuestas = [
      () => HttpResponse.json({ codigo: "no_autorizado", mensaje: "Correo o contraseña incorrectos" }, { status: 401 }),
      () => HttpResponse.json({ codigo: "validacion", mensaje: "Datos inválidos",
                                errores: [{ campo: "password", mensaje: "Texto demasiado corto" }] }, { status: 422 }),
      () => new HttpResponse("Internal Server Error", { status: 500 }),
      () => HttpResponse.error(),
    ];
    const errores: ErrorApi[] = [];
    for (const responder of respuestas) {
      servidor.use(http.post(`${API}/auth/admin/login`, responder));
      errores.push(await errorDe(entrar("admin@queseria.test", CLAVE)));
    }
    guardarSesion(respuestaLogin(TOKEN));
    for (const status of [401, 403, 409, 500]) {
      if (status === 401) guardarSesion(respuestaLogin(TOKEN));
      servidor.use(http.get(`${API}/rutas`, () => HttpResponse.json({ codigo: "x", mensaje: "y" }, { status })));
      errores.push(await errorDe(pedir("GET", "/rutas")));
    }
    servidor.use(http.get(`${API}/rutas`, () => HttpResponse.error()));
    guardarSesion(respuestaLogin(TOKEN));
    errores.push(await errorDe(pedir("GET", "/rutas")));

    const filtrado = errores.some((e) =>
      [e.message, e.codigo, e.stack, JSON.stringify(e), JSON.stringify(e.errores)]
        .some((t) => contiene(t, TOKEN) || contiene(t, CLAVE)));
    expect(filtrado).toBe(false);
    expect(consola.llamadas()).toBe(0);
    expect(consola.mostro(TOKEN) || consola.mostro(CLAVE)).toBe(false);
  });
});
