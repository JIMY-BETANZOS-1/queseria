import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Acopiador, Dispositivo } from "../api/tipos";
import { contiene, espiarConsola, respuestaLogin } from "../pruebas/datos";
import { acopiador, CODIGO, codigoActivacion, dispositivo } from "../pruebas/fabricas";
import { renderizar, ubicacion } from "../pruebas/renderizar";
import { API, servidor } from "../pruebas/servidor";
import { guardarSesion } from "../sesion/almacen";

beforeEach(() => {
  guardarSesion(respuestaLogin());
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Acopiador 7 con sus celulares; cuenta cuántas veces se pidió cada cosa. */
function simular(a: Acopiador, celulares: Dispositivo[] = [dispositivo()]) {
  const cuenta = { acopiador: 0, celulares: 0, codigos: 0, desactivados: [] as number[] };
  let lista = celulares;
  servidor.use(
    http.get(`${API}/acopiadores/7`, () => {
      cuenta.acopiador += 1;
      return HttpResponse.json(a);
    }),
    http.get(`${API}/usuarios/7/dispositivos`, () => {
      cuenta.celulares += 1;
      return HttpResponse.json(lista);
    }),
    http.post(`${API}/usuarios/7/codigo-activacion`, () => {
      cuenta.codigos += 1;
      return HttpResponse.json(codigoActivacion(), { status: 201 });
    }),
    http.post(`${API}/dispositivos/:id/desactivar`, ({ params }) => {
      const id = Number(params.id);
      cuenta.desactivados.push(id);
      lista = lista.map((d) => (d.id === id ? { ...d, activo: false } : d));
      return HttpResponse.json(lista.find((d) => d.id === id));
    }),
  );
  return cuenta;
}

async function abrirConfirmacion() {
  const usuario = userEvent.setup();
  await usuario.click(await screen.findByRole("button", { name: "Generar código de activación" }));
  return { usuario, ventana: screen.getByRole("dialog", { name: "Generar código de activación" }) };
}

describe("código de activación", () => {
  it("la confirmación avisa que el código anterior deja de servir; con celular activo, también eso", async () => {
    simular(acopiador({ celular_vinculado: true }));
    renderizar("/acopiadores/7");

    const { ventana } = await abrirConfirmacion();
    expect(ventana).toHaveTextContent("Si había un código anterior sin usar, deja de servir.");
    expect(ventana).toHaveTextContent("Ya tiene un celular activo");
    expect(ventana).toHaveTextContent("si es otro aparato, el actual deja de funcionar");
  });

  it("sin celular vinculado no habla del celular actual", async () => {
    simular(acopiador({ pin_pendiente: true, celular_vinculado: false }), []);
    renderizar("/acopiadores/7");

    const { ventana } = await abrirConfirmacion();
    expect(ventana).toHaveTextContent("deja de servir");
    expect(ventana).not.toHaveTextContent("Ya tiene un celular activo");
  });

  it("cancelar no genera nada", async () => {
    const cuenta = simular(acopiador());
    renderizar("/acopiadores/7");

    const { usuario, ventana } = await abrirConfirmacion();
    await usuario.click(within(ventana).getByRole("button", { name: "Cancelar" }));
    expect(cuenta.codigos).toBe(0);
  });

  it("se muestra una vez con su vencimiento en hora de Lima y al cerrar desaparece de todas partes", async () => {
    const consola = espiarConsola();
    const cuenta = simular(acopiador({ pin_pendiente: true, celular_vinculado: false }), []);
    renderizar("/acopiadores/7");
    await screen.findByText("Pendiente de activar");
    const pedidosAntes = cuenta.acopiador;

    const { usuario, ventana } = await abrirConfirmacion();
    await usuario.click(within(ventana).getByRole("button", { name: "Generar código" }));

    const codigo = await screen.findByLabelText("Código de activación");
    expect(codigo.textContent === CODIGO).toBe(true);
    const ventanaCodigo = screen.getByRole("dialog", { name: /Código de activación de/ });
    expect(ventanaCodigo).toHaveTextContent("Vence a las 11:05 (hora de Lima) y sirve una sola vez.");
    expect(ventanaCodigo).toHaveTextContent("No se volverá a mostrar");
    expect(cuenta.codigos).toBe(1);

    await usuario.click(screen.getByRole("button", { name: "Listo, ya lo anoté" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const rastros = [document.body.innerHTML, ubicacion(), document.title,
                     JSON.stringify({ ...window.sessionStorage }), JSON.stringify({ ...window.localStorage })];
    expect(rastros.some((t) => contiene(t, CODIGO))).toBe(false);
    expect(consola.mostro(CODIGO)).toBe(false);
    // Después de cerrar se vuelven a pedir los datos para ver el estado nuevo
    await waitFor(() => expect(cuenta.acopiador).toBeGreaterThan(pedidosAntes));
  });

  it("Copiar lo copia y avisa que queda en el portapapeles", async () => {
    simular(acopiador());
    renderizar("/acopiadores/7");
    const { usuario, ventana } = await abrirConfirmacion();   // userEvent instala un portapapeles de prueba
    await usuario.click(within(ventana).getByRole("button", { name: "Generar código" }));
    await screen.findByLabelText("Código de activación");

    await usuario.click(screen.getByRole("button", { name: "Copiar" }));
    expect((await navigator.clipboard.readText()) === CODIGO).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent("Queda en el portapapeles de este computador hasta que copie otra cosa.");
  });

  it("si el navegador no deja copiar, lo deja seleccionado y avisa igual del portapapeles", async () => {
    simular(acopiador());
    renderizar("/acopiadores/7");
    const { usuario, ventana } = await abrirConfirmacion();
    await usuario.click(within(ventana).getByRole("button", { name: "Generar código" }));
    await screen.findByLabelText("Código de activación");
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("Permiso denegado"));

    await usuario.click(screen.getByRole("button", { name: "Copiar" }));
    expect(window.getSelection()?.toString() === CODIGO).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent("quedó seleccionado, cópielo con Ctrl+C");
    expect(screen.getByRole("status")).toHaveTextContent("queda en el portapapeles de este computador");
  });

  it("si el servidor rechaza, el error se ve en la confirmación y no aparece ningún código", async () => {
    simular(acopiador());
    servidor.use(http.post(`${API}/usuarios/7/codigo-activacion`, () =>
      HttpResponse.json({ codigo: "validacion", mensaje: "Solo acopiadores y analistas usan la app móvil" }, { status: 422 })));
    renderizar("/acopiadores/7");

    const { usuario, ventana } = await abrirConfirmacion();
    await usuario.click(within(ventana).getByRole("button", { name: "Generar código" }));
    expect(await within(ventana).findByRole("alert")).toHaveTextContent("Solo acopiadores y analistas usan la app móvil");
    expect(screen.queryByLabelText("Código de activación")).not.toBeInTheDocument();
  });

  it("Esc cierra la confirmación y el foco vuelve al botón", async () => {
    simular(acopiador());
    renderizar("/acopiadores/7");

    const { usuario } = await abrirConfirmacion();
    await usuario.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generar código de activación" })).toHaveFocus();
  });
});

describe("celulares", () => {
  it("lista los celulares con modelo, identificador corto y fechas en hora de Lima", async () => {
    simular(acopiador(), [dispositivo(), dispositivo({ id: 30, modelo: null, activo: false, ultimo_acceso: null })]);
    renderizar("/acopiadores/7");

    const tabla = await screen.findByRole("table");
    const filas = within(tabla).getAllByRole("row");
    expect(filas[1]).toHaveTextContent("realme RMX3710");
    expect(filas[1]).toHaveTextContent("3f2a9c1e");
    expect(filas[1]).not.toHaveTextContent("3f2a9c1e-0000");
    expect(filas[1]).toHaveTextContent("10/10/2026 12:00");
    expect(filas[1]).toHaveTextContent("18/10/2026 06:15");
    expect(filas[2]).toHaveTextContent("Sin modelo");
    expect(filas[2]).toHaveTextContent("Nunca");
    expect(within(filas[2]!).queryByRole("button")).not.toBeInTheDocument();   // ya desactivado
  });

  it("desactivar un celular pide confirmación con lo que pasa y actualiza la tabla", async () => {
    const cuenta = simular(acopiador());
    renderizar("/acopiadores/7");
    const usuario = userEvent.setup();

    await usuario.click(await screen.findByRole("button", { name: "Desactivar celular" }));
    const ventana = screen.getByRole("dialog", { name: "Desactivar celular" });
    expect(ventana).toHaveTextContent("deja de poder entrar y sincronizar al instante");
    expect(ventana).toHaveTextContent("Lo que tenga sin enviar se queda guardado en el celular: no se borra.");
    expect(ventana).toHaveTextContent("genere un código nuevo y actívelo en ese mismo celular");

    await usuario.click(within(ventana).getByRole("button", { name: "Desactivar celular" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(cuenta.desactivados).toEqual([31]);
    expect(await within(screen.getByRole("table")).findByText("Desactivado")).toBeInTheDocument();
  });

  it("sin celulares lo dice", async () => {
    simular(acopiador({ pin_pendiente: true, celular_vinculado: false }), []);
    renderizar("/acopiadores/7");
    expect(await screen.findByText("Todavía no activó ningún celular.")).toBeInTheDocument();
  });

  it("ninguna pantalla muestra PIN ni hashes", async () => {
    simular(acopiador());
    renderizar("/acopiadores/7");
    await screen.findByRole("table");
    expect(document.body.textContent ?? "").not.toMatch(/pin_hash|password_hash|codigo_hash|\bPIN:/i);
  });
});
