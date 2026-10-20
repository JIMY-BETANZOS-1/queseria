import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import type { Alerta, RevisarAlerta } from "../../api/tipos";
import { respuestaLogin } from "../../pruebas/datos";
import { alerta, productor, recoleccion } from "../../pruebas/fabricas";
import { irPorMenu } from "../../pruebas/menu";
import { renderizar, ubicacion } from "../../pruebas/renderizar";
import { API, servidor } from "../../pruebas/servidor";
import { guardarSesion } from "../../sesion/almacen";

beforeEach(() => {
  guardarSesion(respuestaLogin());   // admin id 1, "Administrador de Prueba"
});

/**
 * API simulada de alertas: filtra como el backend (pendientes por defecto, tipo, recolección; orden de la más
 * antigua a la más reciente) y al revisar libera la retención si era la única alerta que retenía.
 */
function simular(inicial: Alerta[]) {
  let alertas = inicial;
  const enviado = { consultas: [] as string[], revisiones: [] as { id: number; cuerpo: RevisarAlerta }[] };
  servidor.use(
    http.get(`${API}/alertas`, ({ request }) => {
      const url = new URL(request.url);
      enviado.consultas.push(url.search);
      const todas = url.searchParams.get("todas") === "true";
      const tipo = url.searchParams.get("tipo");
      const rec = url.searchParams.get("recoleccion_id");
      return HttpResponse.json(alertas
        .filter((a) => (todas || a.revisada_en === null) && (!tipo || a.tipo === tipo) && (!rec || a.recoleccion_id === rec))
        .sort((x, y) => x.creada_en.localeCompare(y.creada_en)));
    }),
    http.post(`${API}/alertas/:id/revisar`, async ({ params, request }) => {
      const id = Number(params.id);
      const cuerpo = (await request.json()) as RevisarAlerta;
      enviado.revisiones.push({ id, cuerpo });
      alertas = alertas.map((a) => (a.id === id
        ? { ...a, revisada_por: 1, revisada_en: "2026-10-18T10:30:00-05:00", resolucion: cuerpo.resolucion,
            recoleccion_retenida: a.recoleccion_retenida === null ? null : false }
        : a));
      return HttpResponse.json(alertas.find((a) => a.id === id));
    }),
  );
  return enviado;
}

const SIN_GPS = alerta({ id: 1, creada_en: "2026-10-18T06:16:00-05:00" });
const BLOQUEADO = alerta({ id: 2, tipo: "productor_bloqueado", detalle: "Se recibió leche de un productor bloqueado",
                           creada_en: "2026-10-17T06:16:00-05:00", recoleccion_retenida: true,
                           recoleccion_id: "0f6c2a4e-0000-4000-8000-000000000002" });
const FIRMA = alerta({ id: 3, tipo: "firma_invalida", detalle: "La firma no coincide", creada_en: "2026-10-18T07:00:00-05:00",
                       recoleccion_retenida: true, recoleccion_id: "0f6c2a4e-0000-4000-8000-000000000003" });
const DUPLICADO = alerta({ id: 4, tipo: "posible_duplicado", creada_en: "2026-10-18T08:00:00-05:00",
                           detalle: "Mismo productor y litros registrados hace menos de 30 minutos" });
const REVISADA_MIA = alerta({ id: 5, tipo: "hora_inconsistente", creada_en: "2026-10-10T06:00:00-05:00",
                              revisada_por: 1, revisada_en: "2026-10-11T09:05:00-05:00", resolucion: "Celular sin hora automática" });
const REVISADA_OTRO = alerta({ id: 6, tipo: "litros_atipicos", creada_en: "2026-10-09T06:00:00-05:00",
                               revisada_por: 3, revisada_en: "2026-10-10T08:00:00-05:00", resolucion: "Entrega grande avisada" });

function fila(texto: string | RegExp): HTMLElement {
  return screen.getByText(texto, { selector: "td" }).closest("tr")!;
}

function tipos(): string[] {
  return screen.getAllByRole("row").slice(1).map((f) => within(f).getAllByRole("cell")[0]!.textContent ?? "");
}

async function abrirRevision(usuario: ReturnType<typeof userEvent.setup>, detalle: string) {
  await usuario.click(within(fila(detalle)).getByRole("button", { name: "Revisar" }));
  return screen.getByRole("dialog");
}

describe("alertas", () => {
  it("el menú lleva a Alertas: pendientes, las más antiguas primero, con resumen por tipo", async () => {
    const enviado = simular([SIN_GPS, BLOQUEADO, FIRMA, DUPLICADO, REVISADA_MIA]);
    renderizar("/");
    await irPorMenu(userEvent.setup(), "Revisión", "Alertas");

    expect(ubicacion()).toBe("/alertas");
    expect(await screen.findByText("4 pendientes")).toBeInTheDocument();
    expect(enviado.consultas).toEqual(["?limit=1000"]);
    expect(tipos()).toEqual(["Productor bloqueado Retiene el pago", "Sin ubicación", "Firma inválida Retiene el pago",
                             "Posible duplicado"]);
    expect(screen.getByText(/2 retienen el pago/)).toHaveTextContent(
      "(Sin ubicación: 1, Firma inválida: 1, Productor bloqueado: 1, Posible duplicado: 1)");
    await waitFor(() => expect(document.title).toBe("Alertas · Quesería Huata"));
  });

  it("cada fila muestra su recolección (hora Lima, productor con enlace, litros, quién) y el pago", async () => {
    simular([SIN_GPS, BLOQUEADO, alerta({ id: 7, detalle: "Anulada", recoleccion_retenida: null,
                                          creada_en: "2026-10-18T09:00:00-05:00" })]);
    renderizar("/alertas");

    const sinGps = within(await screen.findByText("No hubo señal GPS al registrar").then((c) => c.closest("tr")!));
    expect(sinGps.getByText(/18\/10\/2026 06:15/)).toBeInTheDocument();
    expect(sinGps.getByRole("link", { name: "Rosa Condori Huanca" })).toHaveAttribute("href", "/productores/120");
    expect(sinGps.getByText(/32\.5 L/)).toBeInTheDocument();
    expect(sinGps.getByText(/Juan Carlos Mamani Quispe/)).toBeInTheDocument();
    expect(sinGps.getByText("No retenida")).toBeInTheDocument();
    expect(within(fila("Se recibió leche de un productor bloqueado")).getByText("Pago retenido")).toBeInTheDocument();
    expect(within(fila("Anulada")).getByText("Recolección anulada")).toBeInTheDocument();
  });

  it("'Mostrar también las revisadas' pide todas, las ordena de la más reciente y dice quién revisó", async () => {
    const enviado = simular([SIN_GPS, REVISADA_MIA, REVISADA_OTRO]);
    renderizar("/alertas");
    const usuario = userEvent.setup();
    await screen.findByText("1 pendiente");

    await usuario.click(screen.getByLabelText("Mostrar también las revisadas"));
    await waitFor(() => expect(tipos()).toEqual(["Sin ubicación", "Hora inconsistente", "Litros atípicos"]));
    expect(enviado.consultas.at(-1)).toBe("?todas=true&limit=1000");
    expect(ubicacion()).toBe("/alertas?todas=1");

    // El backend solo devuelve el id de quien revisó: el nombre se conoce si es el admin de esta sesión
    expect(within(fila("Hora inconsistente")).getByText(/Revisada por/))
      .toHaveTextContent("Revisada por Administrador de Prueba el 11/10/2026 09:05Celular sin hora automática");
    expect(within(fila("Litros atípicos")).getByText(/Revisada por/))
      .toHaveTextContent("Revisada por el usuario n.º 3 el 10/10/2026 08:00Entrega grande avisada");
  });

  it("el filtro de tipo viaja al servidor y queda en la URL", async () => {
    const enviado = simular([SIN_GPS, BLOQUEADO]);
    renderizar("/alertas");
    const usuario = userEvent.setup();
    await screen.findByText("2 pendientes");

    await usuario.selectOptions(screen.getByLabelText("Tipo"), "Productor bloqueado");
    await waitFor(() => expect(tipos()).toEqual(["Productor bloqueado Retiene el pago"]));
    expect(enviado.consultas.at(-1)).toBe("?tipo=productor_bloqueado&limit=1000");
    expect(ubicacion()).toBe("/alertas?tipo=productor_bloqueado");
  });

  it("desde el detalle del productor, el número de alertas lleva a las de esa recolección", async () => {
    const enviado = simular([SIN_GPS, BLOQUEADO]);
    servidor.use(
      http.get(`${API}/productores/120`, () => HttpResponse.json(productor())),
      http.get(`${API}/productores/120/recolecciones`, () => HttpResponse.json([recoleccion({ alertas_pendientes: 1 })])),
      http.get(`${API}/rutas`, () => HttpResponse.json([])),
    );
    renderizar("/productores/120");
    const usuario = userEvent.setup();

    await usuario.click(await screen.findByRole("link", { name: "1 sin revisar: ver alertas" }));
    expect(ubicacion()).toBe("/alertas?recoleccion=0f6c2a4e-0000-4000-8000-000000000001");
    await waitFor(() => expect(tipos()).toEqual(["Sin ubicación"]));
    expect(enviado.consultas.at(-1)).toBe("?recoleccion_id=0f6c2a4e-0000-4000-8000-000000000001&limit=1000");
    expect(screen.getByText(/Solo las alertas de una recolección/)).toBeInTheDocument();

    await usuario.click(screen.getByRole("button", { name: "Ver todas" }));
    await waitFor(() => expect(tipos()).toHaveLength(2));
    expect(ubicacion()).toBe("/alertas");
  });

  it("un filtro de recolección inválido no llama a la API", async () => {
    const enviado = simular([SIN_GPS]);
    renderizar("/alertas?recoleccion=no-es-uuid");
    expect(await screen.findByText(/El filtro de recolección no es válido/)).toBeInTheDocument();
    expect(enviado.consultas).toEqual([]);
  });

  it("sin pendientes lo dice", async () => {
    simular([REVISADA_MIA]);
    renderizar("/alertas");
    expect(await screen.findByText("No hay alertas pendientes.")).toBeInTheDocument();
  });

  describe("revisar", () => {
    it("exige resolución (no solo espacios) y envía el texto sin espacios alrededor", async () => {
      const enviado = simular([SIN_GPS]);
      renderizar("/alertas");
      const usuario = userEvent.setup();
      await screen.findByText("1 pendiente");

      const ventana = await abrirRevision(usuario, "No hubo señal GPS al registrar");
      expect(ventana).toHaveAccessibleName("Revisar alerta: Sin ubicación");
      await usuario.type(within(ventana).getByLabelText("Resolución"), "   ");
      await usuario.click(within(ventana).getByRole("button", { name: "Marcar como revisada" }));
      expect(within(ventana).getByLabelText("Resolución")).toHaveAccessibleDescription("Escriba la resolución");
      expect(enviado.revisiones).toEqual([]);

      await usuario.type(within(ventana).getByLabelText("Resolución"), " Zona sin señal, confirmado con el acopiador ");
      await usuario.click(within(ventana).getByRole("button", { name: "Marcar como revisada" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(enviado.revisiones).toEqual([{ id: 1, cuerpo: { resolucion: "Zona sin señal, confirmado con el acopiador" } }]);
    });

    it("una que no retiene: lo dice, y la fila pasa a revisada por el admin de la sesión", async () => {
      simular([SIN_GPS]);
      renderizar("/alertas");
      const usuario = userEvent.setup();
      await screen.findByText("1 pendiente");

      const ventana = await abrirRevision(usuario, "No hubo señal GPS al registrar");
      expect(ventana).toHaveTextContent("Queda como revisada, con su resolución y la fecha. No se puede deshacer.");
      expect(ventana).toHaveTextContent("Esta alerta no retiene el pago: revisarla solo deja constancia.");
      expect(ventana).not.toHaveTextContent("Libera el pago");
      expect(ventana).not.toHaveTextContent("precio de sanción");

      await usuario.type(within(ventana).getByLabelText("Resolución"), "Zona sin señal");
      await usuario.click(within(ventana).getByRole("button", { name: "Marcar como revisada" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(within(fila("No hubo señal GPS al registrar")).getByText(/Revisada por/))
        .toHaveTextContent("Revisada por Administrador de Prueba el 18/10/2026 10:30Zona sin señal");
      expect(screen.getByText("0 pendientes")).toBeInTheDocument();
    });

    it("productor bloqueado: libera el pago, no cambia el bloqueo y dice que se paga a precio de sanción", async () => {
      simular([BLOQUEADO]);
      renderizar("/alertas");
      const usuario = userEvent.setup();
      await screen.findByText("1 pendiente");

      const ventana = await abrirRevision(usuario, "Se recibió leche de un productor bloqueado");
      expect(ventana).toHaveTextContent(
        "Libera el pago de esta recolección, salvo que su productor no esté aprobado o tenga otra alerta que retenga " +
        "sin revisar. Solo se paga cuando el analista la haya revisado.");
      expect(ventana).toHaveTextContent("No cambia el bloqueo del productor. Esa leche se paga a precio de sanción.");
      expect(ventana).toHaveTextContent("Si esa leche no debe pagarse, anule la recolección en lugar de revisar esta alerta.");
      expect(ventana).not.toHaveTextContent("solo deja constancia");

      await usuario.type(within(ventana).getByLabelText("Resolución"), "Se paga: entregó antes de enterarse");
      await usuario.click(within(ventana).getByRole("button", { name: "Marcar como revisada" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(within(fila("Se recibió leche de un productor bloqueado")).getByText("No retenida")).toBeInTheDocument();
    });

    it("firma inválida: libera el pago, pero no habla de bloqueo ni de precio de sanción", async () => {
      simular([FIRMA]);
      renderizar("/alertas");
      const usuario = userEvent.setup();
      await screen.findByText("1 pendiente");

      const ventana = await abrirRevision(usuario, "La firma no coincide");
      expect(ventana).toHaveTextContent("Libera el pago de esta recolección");
      expect(ventana).not.toHaveTextContent("bloqueo");
      expect(ventana).not.toHaveTextContent("precio de sanción");
    });

    it("posible duplicado: sugiere anular una de las dos", async () => {
      simular([DUPLICADO]);
      renderizar("/alertas");
      const usuario = userEvent.setup();
      await screen.findByText("1 pendiente");

      const ventana = await abrirRevision(usuario, "Mismo productor y litros registrados hace menos de 30 minutos");
      expect(ventana).toHaveTextContent("Si de verdad está duplicada, anule una de las dos recolecciones.");
      expect(ventana).toHaveTextContent("Esta alerta no retiene el pago");
    });

    it("409 (otro admin ya la revisó): muestra el mensaje en la ventana y recarga la lista", async () => {
      const enviado = simular([SIN_GPS]);
      servidor.use(http.post(`${API}/alertas/:id/revisar`, () =>
        HttpResponse.json({ codigo: "conflicto", mensaje: "La alerta ya fue revisada" }, { status: 409 })));
      renderizar("/alertas");
      const usuario = userEvent.setup();
      await screen.findByText("1 pendiente");

      const ventana = await abrirRevision(usuario, "No hubo señal GPS al registrar");
      await usuario.type(within(ventana).getByLabelText("Resolución"), "Revisada");
      await usuario.click(within(ventana).getByRole("button", { name: "Marcar como revisada" }));

      expect(await within(ventana).findByRole("alert")).toHaveTextContent("La alerta ya fue revisada");
      await waitFor(() => expect(enviado.consultas).toHaveLength(2));
    });
  });
});
