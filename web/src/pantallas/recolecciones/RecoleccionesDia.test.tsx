import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnularRecoleccion, RecoleccionDetalle } from "../../api/tipos";
import { respuestaLogin } from "../../pruebas/datos";
import { alerta, recoleccion } from "../../pruebas/fabricas";
import { irPorMenu } from "../../pruebas/menu";
import { renderizar, ubicacion } from "../../pruebas/renderizar";
import { API, servidor } from "../../pruebas/servidor";
import { guardarSesion } from "../../sesion/almacen";
import { resumir } from "./ResumenPorPersona";
import { textoUbicacion } from "./ubicacion";

beforeEach(() => {
  guardarSesion(respuestaLogin());
  // 23:30 del 18/10 en Lima = 04:30 UTC del 19/10 (y las pruebas corren con TZ=Asia/Tokyo): "hoy" es el 18
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 19, 4, 30));
});

afterEach(() => {
  vi.useRealTimers();
});

const id = (n: number) => `0f6c2a4e-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Juan (acopiador 7): 2 entregas + 1 anulada. Ana (acopiadora 8): 1 alterada con alerta y retenida. Analista: 1 externa.
const JUAN_1 = recoleccion({ recoleccion_id: id(1), registrada_en: "2026-10-18T06:15:00-05:00", litros: 32.5, precision_m: 8 });
const JUAN_2 = recoleccion({ recoleccion_id: id(2), registrada_en: "2026-10-18T06:40:00-05:00", litros: 20.25, revisada: false,
                             pagable: false, origen_ubicacion: "ninguna", latitud: null, longitud: null, precision_m: null,
                             alertas_pendientes: 1, productor: "Pedro Quispe", productor_id: 121, productor_codigo: "P-0121" });
const JUAN_ANULADA = recoleccion({ recoleccion_id: id(3), registrada_en: "2026-10-18T07:00:00-05:00", litros: 15,
                                   anulada_en: "2026-10-18T09:00:00-05:00", retenida: null, pagable: null, liquidada: null,
                                   productor: "Marta Anulada", productor_id: 122 });
const ANA = recoleccion({ recoleccion_id: id(4), registrada_en: "2026-10-18T07:30:00-05:00", litros: 40, registrado_por: 8,
                          registrado_por_nombre: "Ana Quispe Flores", color_hex: "#16A34A", estado_calidad: "alterado",
                          alertas_pendientes: 2, retenida: true, pagable: false, ubicacion_simulada: true,
                          origen_ubicacion: "ultima_conocida", precision_m: 120.4, productor: "Lucía Mamani", productor_id: 123 });
const ANALISTA = recoleccion({ recoleccion_id: id(5), registrada_en: "2026-10-18T10:00:00-05:00", litros: 100, registrado_por: 12,
                               registrado_por_nombre: "María Elena Ccama Apaza", color_hex: "#6B7280", tipo_productor: "externo",
                               ruta_id: null, ruta: null, productor: "Lácteos del Lago", productor_id: 300, liquidada: true });
const DIA = [ANALISTA, ANA, JUAN_ANULADA, JUAN_2, JUAN_1];   // el servidor las da de la más reciente a la más antigua

/** API simulada: las del día pedido (con su consulta) y anular como la base (409 si ya anulada o liquidada). */
function simular(porFecha: Record<string, RecoleccionDetalle[]>) {
  const datos = { ...porFecha };
  const enviado = { consultas: [] as string[], anulaciones: [] as { id: string; cuerpo: AnularRecoleccion }[] };
  servidor.use(
    http.get(`${API}/recolecciones`, ({ request }) => {
      const url = new URL(request.url);
      enviado.consultas.push(url.search);
      return HttpResponse.json(datos[url.searchParams.get("desde") ?? ""] ?? []);
    }),
    http.post(`${API}/recolecciones/:id/anular`, async ({ params, request }) => {
      const cuerpo = (await request.json()) as AnularRecoleccion;
      enviado.anulaciones.push({ id: String(params.id), cuerpo });
      for (const [fecha, filas] of Object.entries(datos)) {
        const r = filas.find((x) => x.recoleccion_id === params.id);
        if (!r) continue;
        if (r.anulada_en) return HttpResponse.json({ codigo: "conflicto", mensaje: "La recolección ya está anulada" }, { status: 409 });
        const anulada = { ...r, anulada_en: "2026-10-18T23:31:00-05:00", retenida: null, pagable: null, liquidada: null };
        datos[fecha] = filas.map((x) => (x.recoleccion_id === r.recoleccion_id ? anulada : x));
        return HttpResponse.json(anulada);
      }
      return HttpResponse.json({ codigo: "no_encontrado", mensaje: "La recolección no existe" }, { status: 404 });
    }),
  );
  return enviado;
}

function entregas(): HTMLElement {
  return screen.getByRole("heading", { name: "Entregas" }).closest("section")!;
}

function fila(productor: string): HTMLElement {
  return within(entregas()).getByRole("link", { name: productor }).closest("tr")!;
}

function filaResumen(nombre: string): string[] {
  const tabla = screen.getByRole("table", { name: "Resumen por persona" });
  const f = within(tabla).getAllByRole("row").find((r) => r.textContent?.includes(nombre))!;
  return within(f).getAllByRole("cell").map((c) => c.textContent?.trim() ?? "");
}

async function abrirAnular(usuario: ReturnType<typeof userEvent.setup>, productor: string) {
  await usuario.click(within(fila(productor)).getByRole("button", { name: "Anular" }));
  return screen.getByRole("dialog", { name: "Anular recolección" });
}

describe("recolecciones del día", () => {
  it("el menú lleva a la pantalla; por defecto es hoy en Lima y pide ese día con las anuladas", async () => {
    const enviado = simular({ "2026-10-18": DIA });
    renderizar("/");
    await irPorMenu(userEvent.setup(), "Revisión", "Recolecciones del día");

    expect(ubicacion()).toBe("/recolecciones");
    expect(await screen.findByRole("heading", { name: "Entregas" })).toBeInTheDocument();
    expect(screen.getByLabelText("Fecha")).toHaveValue("2026-10-18");
    expect(screen.getByLabelText("Fecha")).toHaveAttribute("max", "2026-10-18");
    expect(enviado.consultas).toEqual(["?desde=2026-10-18&hasta=2026-10-18&incluir_anuladas=true&limit=1000"]);
    await waitFor(() => expect(document.title).toBe("Recolecciones del día · Quesería Huata"));
  });

  it("día anterior y siguiente cambian la URL y la consulta; no se puede pasar de hoy", async () => {
    const enviado = simular({ "2026-10-18": DIA, "2026-10-17": [JUAN_1] });
    renderizar("/recolecciones");
    const usuario = userEvent.setup();
    await screen.findByRole("heading", { name: "Entregas" });
    expect(screen.getByRole("button", { name: "Día siguiente" })).toBeDisabled();

    await usuario.click(screen.getByRole("button", { name: "Día anterior" }));
    expect(ubicacion()).toBe("/recolecciones?fecha=2026-10-17");
    await waitFor(() => expect(enviado.consultas.at(-1)).toContain("desde=2026-10-17&hasta=2026-10-17"));
    expect(screen.getByRole("button", { name: "Día siguiente" })).toBeEnabled();

    await usuario.click(screen.getByRole("button", { name: "Día siguiente" }));
    expect(ubicacion()).toBe("/recolecciones?fecha=2026-10-18");
  });

  it("una fecha futura o inválida en la URL muestra hoy y lo avisa", async () => {
    const enviado = simular({ "2026-10-18": DIA });
    renderizar("/recolecciones?fecha=2026-10-19");
    expect(await screen.findByText(/La fecha pedida no es válida o es futura: se muestra hoy \(18\/10\/2026\)/)).toBeInTheDocument();
    await waitFor(() => expect(enviado.consultas).toEqual(["?desde=2026-10-18&hasta=2026-10-18&incluir_anuladas=true&limit=1000"]));
  });

  it("sin recolecciones lo dice", async () => {
    simular({});
    renderizar("/recolecciones?fecha=2026-10-10");
    expect(await screen.findByText("No hubo recolecciones el 10/10/2026.")).toBeInTheDocument();
  });

  it("resumen por persona: las anuladas no suman y se cuentan aparte; total del día", async () => {
    simular({ "2026-10-18": DIA });
    renderizar("/recolecciones");
    await screen.findByRole("heading", { name: "Entregas" });

    // Registró, entregas, litros, alterados, sin revisar, con alertas, retenidas, anuladas
    expect(filaResumen("Juan Carlos")).toEqual(["Juan Carlos Mamani Quispe", "2", "52.75 L", "0 L", "1", "1", "0", "1"]);
    expect(filaResumen("Ana Quispe")).toEqual(["Ana Quispe Flores", "1", "40 L", "40 L", "0", "1", "1", "0"]);
    expect(filaResumen("María Elena")).toEqual(["María Elena Ccama Apaza", "1", "100 L", "0 L", "0", "0", "0", "0"]);
    expect(filaResumen("Total del día")).toEqual(["Total del día", "4", "192.75 L", "40 L", "1", "2", "1", "1"]);
  });

  it("elegir una persona filtra las entregas y queda en la URL; otra vez la quita", async () => {
    simular({ "2026-10-18": DIA });
    renderizar("/recolecciones");
    const usuario = userEvent.setup();
    await screen.findByRole("heading", { name: "Entregas" });

    await usuario.click(screen.getByRole("button", { name: /Ana Quispe Flores/ }));
    expect(ubicacion()).toBe("/recolecciones?persona=8");
    expect(within(entregas()).getAllByRole("row")).toHaveLength(2);   // encabezado + 1
    expect(screen.getByRole("button", { name: /Ana Quispe Flores/ })).toHaveAttribute("aria-pressed", "true");

    await usuario.click(screen.getByRole("button", { name: /Ana Quispe Flores/ }));
    expect(ubicacion()).toBe("/recolecciones");
    expect(within(entregas()).getAllByRole("row")).toHaveLength(6);
  });

  it("cada entrega: hora Lima, productor, ruta, quién, calidad, ubicación, alertas con enlace y pago", async () => {
    simular({ "2026-10-18": DIA });
    renderizar("/recolecciones");
    await screen.findByRole("heading", { name: "Entregas" });

    const juan = within(fila("Rosa Condori Huanca"));
    expect(juan.getByText("06:15")).toBeInTheDocument();
    expect(juan.getByText("Ruta 4 - Collana")).toBeInTheDocument();
    expect(juan.getByText("GPS ±8 m")).toBeInTheDocument();
    expect(juan.getByText("Pagable")).toBeInTheDocument();

    expect(within(fila("Pedro Quispe")).getByText("Sin ubicación")).toBeInTheDocument();
    expect(within(fila("Pedro Quispe")).getByRole("link", { name: "1 sin revisar: ver alertas" }))
      .toHaveAttribute("href", `/alertas?recoleccion=${id(2)}`);

    const ana = within(fila("Lucía Mamani"));
    expect(ana.getByText("Última conocida ±120 m")).toBeInTheDocument();
    expect(ana.getByText("Simulada")).toBeInTheDocument();
    expect(ana.getByText("Alterada")).toBeInTheDocument();
    expect(ana.getByText("Retenida")).toBeInTheDocument();

    expect(within(fila("Lácteos del Lago")).getByText("Externo")).toBeInTheDocument();
  });

  it("una anulada se ve atenuada con su fecha; una liquidada no ofrece Anular", async () => {
    simular({ "2026-10-18": DIA });
    renderizar("/recolecciones");
    await screen.findByRole("heading", { name: "Entregas" });

    const anulada = fila("Marta Anulada");
    expect(anulada).toHaveClass("anulada");
    expect(within(anulada).getByText("Anulada")).toBeInTheDocument();
    expect(within(anulada).getByText("el 18/10/2026 09:00")).toBeInTheDocument();
    expect(within(anulada).queryByRole("button", { name: "Anular" })).not.toBeInTheDocument();

    const liquidada = within(fila("Lácteos del Lago"));
    expect(liquidada.getByText("Liquidada: no se anula")).toBeInTheDocument();
    expect(liquidada.queryByRole("button", { name: "Anular" })).not.toBeInTheDocument();
  });

  describe("anular", () => {
    it("exige motivo (no solo espacios), envía el texto sin espacios y la fila queda Anulada", async () => {
      const enviado = simular({ "2026-10-18": DIA });
      renderizar("/recolecciones");
      const usuario = userEvent.setup();
      await screen.findByRole("heading", { name: "Entregas" });

      const ventana = await abrirAnular(usuario, "Rosa Condori Huanca");
      const boton = within(ventana).getByRole("button", { name: "Anular recolección" });
      expect(boton).toHaveClass("boton-peligro");
      await usuario.type(within(ventana).getByLabelText("Motivo"), "   ");
      await usuario.click(boton);
      expect(within(ventana).getByLabelText("Motivo")).toHaveAccessibleDescription("Escriba el motivo");
      expect(enviado.anulaciones).toEqual([]);

      await usuario.type(within(ventana).getByLabelText("Motivo"), " Registrada dos veces ");
      await usuario.click(boton);
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(enviado.anulaciones).toEqual([{ id: id(1), cuerpo: { motivo: "Registrada dos veces" } }]);

      const f = within(fila("Rosa Condori Huanca"));
      expect(f.getByText("Anulada")).toBeInTheDocument();
      expect(f.getByText("el 18/10/2026 23:31")).toBeInTheDocument();
      expect(f.queryByRole("button", { name: "Anular" })).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Recolección anulada.");
      expect(screen.getByRole("status")).not.toHaveTextContent("sin revisar");
      // Ya no suma: Juan queda con 1 entrega de 20.25 L y 2 anuladas
      expect(filaResumen("Juan Carlos")).toEqual(["Juan Carlos Mamani Quispe", "1", "20.25 L", "0 L", "1", "1", "0", "2"]);
    });

    it("textos siempre presentes; de ruta: el celular del acopiador la mostrará como Anulada", async () => {
      simular({ "2026-10-18": DIA });
      renderizar("/recolecciones");
      const usuario = userEvent.setup();
      await screen.findByRole("heading", { name: "Entregas" });

      const ventana = await abrirAnular(usuario, "Rosa Condori Huanca");
      expect(ventana).toHaveTextContent("Rosa Condori Huanca (P-0120) · 32.5 L · 18/10/2026 06:15 · registró Juan Carlos Mamani Quispe");
      expect(ventana).toHaveTextContent(
        "No se borra: queda anulada con su motivo, la fecha y quién la anuló. No se puede deshacer.");
      expect(ventana).toHaveTextContent(
        "No se paga, y deja de contar para la comisión del acopiador y en la leche de su jornada.");
      expect(ventana).toHaveTextContent("Si la leche de ese día ya se usó en un lote, el lote no cambia.");
      expect(ventana).toHaveTextContent(
        "En el celular de Juan Carlos Mamani Quispe, \"Mi día\" la mostrará como Anulada y no la sumará, cuando tenga señal.");
      expect(ventana).not.toHaveTextContent("sanción");
      expect(ventana).not.toHaveTextContent("sin revisar");
    });

    it("alterada con alertas: avisa de la sanción y de las alertas; luego ofrece revisarlas", async () => {
      simular({ "2026-10-18": DIA });
      renderizar("/recolecciones");
      const usuario = userEvent.setup();
      await screen.findByRole("heading", { name: "Entregas" });

      const ventana = await abrirAnular(usuario, "Lucía Mamani");
      expect(ventana).toHaveTextContent("Si esta leche originó una sanción del productor, la sanción se levanta.");
      expect(ventana).toHaveTextContent("Sus 2 alertas sin revisar siguen pendientes: revíselas después.");

      await usuario.type(within(ventana).getByLabelText("Motivo"), "Leche de otro productor");
      await usuario.click(within(ventana).getByRole("button", { name: "Anular recolección" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(screen.getByRole("status")).toHaveTextContent("Recolección anulada. Tiene 2 alertas sin revisar: revisarlas.");
      expect(within(screen.getByRole("status")).getByRole("link", { name: "revisarlas" }))
        .toHaveAttribute("href", `/alertas?recoleccion=${id(4)}`);
    });

    it("una alerta: singular; externo (analista): no habla del celular de Mi día", async () => {
      const externa = recoleccion({ ...ANALISTA, liquidada: false, alertas_pendientes: 1 });
      simular({ "2026-10-18": [externa, JUAN_2] });
      renderizar("/recolecciones");
      const usuario = userEvent.setup();
      await screen.findByRole("heading", { name: "Entregas" });

      expect(await abrirAnular(usuario, "Pedro Quispe")).toHaveTextContent("Su alerta sin revisar sigue pendiente: revísela después.");
      await usuario.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancelar" }));

      const ventana = await abrirAnular(usuario, "Lácteos del Lago");
      expect(ventana).not.toHaveTextContent("Mi día");
    });

    it("409 (ya anulada o liquidada): el mensaje de la base se muestra en la ventana", async () => {
      simular({ "2026-10-18": DIA });
      servidor.use(http.post(`${API}/recolecciones/:id/anular`, () => HttpResponse.json({
        codigo: "conflicto",
        mensaje: `La recolección ${id(1)} ya fue liquidada: no se puede anular ni modificar; quítela primero de su liquidación pendiente`,
      }, { status: 409 })));
      renderizar("/recolecciones");
      const usuario = userEvent.setup();
      await screen.findByRole("heading", { name: "Entregas" });

      const ventana = await abrirAnular(usuario, "Rosa Condori Huanca");
      await usuario.type(within(ventana).getByLabelText("Motivo"), "Duplicada");
      await usuario.click(within(ventana).getByRole("button", { name: "Anular recolección" }));
      expect(await within(ventana).findByRole("alert")).toHaveTextContent("ya fue liquidada: no se puede anular");
      expect(within(fila("Rosa Condori Huanca")).queryByText("Anulada")).not.toBeInTheDocument();
    });
  });

  it("desde una alerta, 'Ver recolección' abre su día con la fila destacada, sin filtro de persona", async () => {
    simular({ "2026-10-17": [recoleccion({ ...JUAN_2, registrada_en: "2026-10-17T06:40:00-05:00" }), ANA] });
    servidor.use(http.get(`${API}/alertas`, () => HttpResponse.json([
      alerta({ fecha: "2026-10-17", recoleccion_id: id(2), productor: "Pedro Quispe", productor_id: 121 }),
    ])));
    renderizar("/alertas");
    const usuario = userEvent.setup();

    await usuario.click(await screen.findByRole("link", { name: "Ver recolección" }));
    expect(ubicacion()).toBe(`/recolecciones?fecha=2026-10-17&recoleccion=${id(2)}`);
    await screen.findByRole("heading", { name: "Entregas" });
    expect(fila("Pedro Quispe")).toHaveAttribute("aria-current", "true");
    expect(fila("Pedro Quispe")).toHaveFocus();
    expect(fila("Lucía Mamani")).not.toHaveAttribute("aria-current");
    expect(screen.getByText(/Se destaca la recolección de la alerta/)).toBeInTheDocument();

    await usuario.click(screen.getByRole("button", { name: "Quitar" }));
    expect(ubicacion()).toBe("/recolecciones?fecha=2026-10-17");
    expect(fila("Pedro Quispe")).not.toHaveAttribute("aria-current");
  });
});

it("con una fila destacada no se aplica el filtro de persona, aunque esté en la URL", async () => {
  guardarSesion(respuestaLogin());
  simular({ "2026-10-18": DIA });
  renderizar(`/recolecciones?persona=8&recoleccion=${id(2)}`);   // persona 8 = Ana; la destacada es de Juan

  await screen.findByRole("heading", { name: "Entregas" });
  expect(fila("Pedro Quispe")).toHaveAttribute("aria-current", "true");
  expect(within(entregas()).getAllByRole("row")).toHaveLength(6);
  expect(screen.getByRole("button", { name: /Ana Quispe Flores/ })).toHaveAttribute("aria-pressed", "false");
});

describe("piezas", () => {
  it("resumir redondea a 2 decimales y ordena por nombre", () => {
    const { personas, total } = resumir([
      recoleccion({ litros: 0.1, registrado_por: 2, registrado_por_nombre: "Zoila" }),
      recoleccion({ litros: 0.2, registrado_por: 1, registrado_por_nombre: "Ángel" }),
    ]);
    expect(personas.map((p) => p.nombre)).toEqual(["Ángel", "Zoila"]);
    expect(total.litros).toBe(0.3);
  });

  it.each([
    [{ origen_ubicacion: "gps" as const, precision_m: 7.6 }, "GPS ±8 m"],
    [{ origen_ubicacion: "gps" as const, precision_m: null }, "GPS"],
    [{ origen_ubicacion: "ultima_conocida" as const, precision_m: null }, "Última conocida"],
    [{ origen_ubicacion: "ninguna" as const, precision_m: null }, "Sin ubicación"],
  ])("textoUbicacion(%j) = %s", (r, texto) => {
    expect(textoUbicacion(r)).toBe(texto);
  });
});
