import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Productor, ProductorCambios, RecoleccionDetalle } from "../../api/tipos";
import { respuestaLogin } from "../../pruebas/datos";
import { acopiador, productor, recoleccion, ruta } from "../../pruebas/fabricas";
import { estadoHistorial, renderizar, ubicacion } from "../../pruebas/renderizar";
import { API, servidor } from "../../pruebas/servidor";
import { guardarSesion } from "../../sesion/almacen";
import { estadoPago } from "./EstadoPago";

const RUTAS = [ruta(), ruta({ id: 22, nombre: "Ruta 5 - Capachica" }), ruta({ id: 23, nombre: "Ruta vieja", activa: false })];

beforeEach(() => {
  guardarSesion(respuestaLogin());
  servidor.use(
    http.get(`${API}/rutas`, () => HttpResponse.json(RUTAS)),
    http.get(`${API}/acopiadores`, () => HttpResponse.json([acopiador()])),
  );
});

/**
 * API simulada del productor 120: GET/PATCH, aprobar (como la base: libera la retención por no aprobado salvo
 * las que tienen alerta que retiene) y sus recolecciones. Registra lo que se envió y cuántas veces se pidió.
 */
function simular(inicial: Productor, recolecciones: RecoleccionDetalle[] = [recoleccion()]) {
  let actual = inicial;
  let lista = recolecciones;
  const enviado = { patch: [] as ProductorCambios[], aprobar: 0, consultas: [] as string[] };
  servidor.use(
    http.get(`${API}/productores/${inicial.id}`, () => HttpResponse.json(actual)),
    http.patch(`${API}/productores/${inicial.id}`, async ({ request }) => {
      const cambios = (await request.json()) as ProductorCambios;
      enviado.patch.push(cambios);
      actual = { ...actual, ...(cambios as Partial<Productor>) };
      return HttpResponse.json(actual);
    }),
    http.post(`${API}/productores/${inicial.id}/aprobar`, () => {
      enviado.aprobar += 1;
      actual = { ...actual, aprobado: true };
      lista = lista.map((r) => {
        const retenida = r.alertas_pendientes > 0;
        return { ...r, productor_pendiente: false, retenida, pagable: r.revisada && !retenida };
      });
      return HttpResponse.json(actual);
    }),
    http.get(`${API}/productores/${inicial.id}/recolecciones`, ({ request }) => {
      enviado.consultas.push(new URL(request.url).search);
      return HttpResponse.json(lista);
    }),
  );
  return enviado;
}

const ALTA = productor({ aprobado: false, creado_por: 7, documento: null, celular: null, latitud_ref: null,
                         longitud_ref: null });
const RETENIDA = recoleccion({ productor_pendiente: true, revisada: false, retenida: true, pagable: false });

function pagoDeFila(fecha: string): string {
  return within(screen.getByText(fecha).closest("tr")!).getAllByRole("cell").at(-1)!.textContent ?? "";
}

describe("detalle del productor", () => {
  it("muestra datos, el tipo sin poder cambiarlo y las últimas 50 recolecciones", async () => {
    const enviado = simular(productor());
    renderizar("/productores/120");

    expect(await screen.findByRole("heading", { name: "Rosa Condori Huanca P-0120" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Documento (DNI o RUC)")).toHaveValue("42345678");
    expect(screen.getByLabelText("Ruta")).toHaveValue("21");
    expect(screen.getByLabelText("Latitud de referencia")).toHaveValue("-15.612345");
    expect(screen.getByText("Tipo:").closest("p")).toHaveTextContent("Tipo: De ruta (no se cambia");
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByText("Pendiente de aprobación")).not.toBeInTheDocument();

    expect(await screen.findByText("18/10/2026 06:15")).toBeInTheDocument();
    expect(screen.getByText("32.5 L")).toBeInTheDocument();
    expect(enviado.consultas).toEqual(["?limit=50"]);
    await waitFor(() => expect(document.title).toBe("Rosa Condori Huanca · Quesería Huata"));
  });

  it("la ayuda de Ruta explica a qué celular pasa, y ofrece las activas más la actual aunque esté inactiva", async () => {
    simular(productor({ ruta_id: 23 }));
    renderizar("/productores/120");

    const campoRuta = await screen.findByLabelText("Ruta");
    expect(campoRuta).toHaveAccessibleDescription(
      "Al cambiarla, el productor pasa al celular del acopiador de la nueva ruta en su próxima sincronización; " +
      "lo que el anterior tenga sin enviar se sube igual.");
    expect(within(campoRuta).getAllByRole("option").map((o) => o.textContent))
      .toEqual(["Elija…", "Ruta 4 - Collana", "Ruta 5 - Capachica", "Ruta vieja (inactiva)"]);
  });

  it("guardar envía solo lo que cambió; vacíos como null y números como números", async () => {
    const enviado = simular(productor());
    renderizar("/productores/120");
    const usuario = userEvent.setup();

    await usuario.clear(await screen.findByLabelText("Celular"));
    await usuario.selectOptions(screen.getByLabelText("Ruta"), "Ruta 5 - Capachica");
    await usuario.clear(screen.getByLabelText("Longitud de referencia"));
    await usuario.type(screen.getByLabelText("Longitud de referencia"), "-69.8");
    await usuario.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByText("Cambios guardados.")).toBeInTheDocument();
    expect(enviado.patch).toEqual([{ celular: null, ruta_id: 22, longitud_ref: -69.8 }]);
  });

  it("sin cambios no envía nada", async () => {
    const enviado = simular(productor());
    renderizar("/productores/120");

    await userEvent.setup().click(await screen.findByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText("No hay cambios que guardar.")).toBeInTheDocument();
    expect(enviado.patch).toEqual([]);
  });

  describe("alta de campo pendiente", () => {
    it("avisa quién la dio de alta y que el pago queda retenido; su entrega figura Retenida", async () => {
      simular(ALTA, [RETENIDA]);
      renderizar("/productores/120");

      expect(await screen.findByText("Pendiente de aprobación")).toBeInTheDocument();
      expect(await screen.findByText(/Alta en el campo por Juan Carlos Mamani Quispe/)).toHaveTextContent(
        "su leche se recibe, pero el pago queda retenido hasta que la apruebe");
      await screen.findByText("18/10/2026 06:15");
      expect(pagoDeFila("18/10/2026 06:15")).toBe("Retenida");
    });

    it("aprobar: confirma con lo que pasa, llama a /aprobar, quita la marca y recarga las entregas", async () => {
      const enviado = simular(ALTA, [RETENIDA]);
      renderizar("/productores/120");
      const usuario = userEvent.setup();

      await usuario.click(await screen.findByRole("button", { name: "Aprobar productor" }));
      const ventana = screen.getByRole("dialog", { name: "Aprobar productor" });
      expect(ventana).toHaveTextContent(
        "Su leche deja de quedar retenida por \"productor no aprobado\", también la ya registrada.");
      expect(ventana).toHaveTextContent("Sigue retenida la que tenga una alerta de productor bloqueado o firma inválida sin revisar");
      expect(ventana).toHaveTextContent("No se puede deshacer desde el panel.");

      await usuario.click(within(ventana).getByRole("button", { name: "Cancelar" }));
      expect(enviado.aprobar).toBe(0);

      await usuario.click(screen.getByRole("button", { name: "Aprobar productor" }));
      await usuario.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Aprobar" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      expect(enviado.aprobar).toBe(1);
      expect(screen.queryByText("Pendiente de aprobación")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Aprobar productor" })).not.toBeInTheDocument();
      await waitFor(() => expect(pagoDeFila("18/10/2026 06:15")).toBe("Por revisar"));   // sin revisar aún
      expect(enviado.consultas).toHaveLength(2);
    });

    it("quien la dio de alta, si no se encuentra, se nombra como 'un acopiador'", async () => {
      simular({ ...ALTA, creado_por: 999 });
      renderizar("/productores/120");
      expect(await screen.findByText(/Alta en el campo por un acopiador/)).toBeInTheDocument();
    });

    it("desactivarla avisa que su leche sigue retenida", async () => {
      simular(ALTA);
      renderizar("/productores/120");

      await userEvent.setup().click(await screen.findByRole("button", { name: "Desactivar productor" }));
      expect(screen.getByRole("dialog", { name: "Desactivar productor" }))
        .toHaveTextContent("Su leche ya registrada sigue retenida por no aprobado.");
    });
  });

  it("desactivar: avisa qué pasa en los celulares y envía solo activo=false; reactivar envía true", async () => {
    const enviado = simular(productor());
    renderizar("/productores/120");
    const usuario = userEvent.setup();

    await usuario.click(await screen.findByRole("button", { name: "Desactivar productor" }));
    const ventana = screen.getByRole("dialog", { name: "Desactivar productor" });
    expect(ventana).toHaveTextContent(
      "Deja de aparecer en los celulares en su próxima sincronización. Lo que tengan sin enviar se sube igual.");
    expect(ventana).not.toHaveTextContent("retenida");
    await usuario.click(within(ventana).getByRole("button", { name: "Desactivar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Inactivo")).toBeInTheDocument();

    await usuario.click(screen.getByRole("button", { name: "Reactivar productor" }));
    expect(screen.getByRole("dialog", { name: "Reactivar productor" }))
      .toHaveTextContent("Vuelve a aparecer en los celulares en su próxima sincronización.");
    await usuario.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Reactivar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(enviado.patch).toEqual([{ activo: false }, { activo: true }]);
  });

  it("muestra calidad, revisión, quién registró, alertas y estado de pago de cada entrega", async () => {
    simular(productor(), [
      recoleccion({ recoleccion_id: "a", registrada_en: "2026-10-18T06:15:00-05:00" }),
      recoleccion({ recoleccion_id: "b", registrada_en: "2026-10-17T06:10:00-05:00", estado_calidad: "alterado",
                    alertas_pendientes: 2, retenida: true, pagable: false }),
      recoleccion({ recoleccion_id: "c", registrada_en: "2026-10-16T06:05:00-05:00", revisada: false, pagable: false }),
      recoleccion({ recoleccion_id: "d", registrada_en: "2026-10-15T06:00:00-05:00", liquidada: true }),
      recoleccion({ recoleccion_id: "e", registrada_en: "2026-10-14T06:00:00-05:00", anulada_en: "2026-10-14T09:00:00-05:00",
                    retenida: null, pagable: null, liquidada: null }),
    ]);
    renderizar("/productores/120");

    await screen.findByText("18/10/2026 06:15");
    expect(pagoDeFila("18/10/2026 06:15")).toBe("Pagable");
    expect(pagoDeFila("17/10/2026 06:10")).toBe("Retenida");
    expect(pagoDeFila("16/10/2026 06:05")).toBe("Por revisar");
    expect(pagoDeFila("15/10/2026 06:00")).toBe("Liquidada");
    expect(pagoDeFila("14/10/2026 06:00")).toBe("Anulada");
    const alterada = within(screen.getByText("17/10/2026 06:10").closest("tr")!);
    expect(alterada.getByText("Alterada")).toBeInTheDocument();
    expect(alterada.getByText("2")).toBeInTheDocument();
    expect(within(screen.getByText("16/10/2026 06:05").closest("tr")!).getByText("No")).toBeInTheDocument();
    expect(screen.queryByText(/Se muestran las últimas/)).not.toBeInTheDocument();
  });

  it("con 50 entregas avisa que se muestran solo las últimas 50", async () => {
    simular(productor(), Array.from({ length: 50 }, (_, i) =>
      recoleccion({ recoleccion_id: `r${i}`, registrada_en: `2026-10-18T06:${String(i).padStart(2, "0")}:00-05:00` })));
    renderizar("/productores/120");
    expect(await screen.findByText("Se muestran las últimas 50.")).toBeInTheDocument();
  });

  it("el aviso de 'Productor creado' desaparece con la primera acción y no vuelve con F5", async () => {
    simular(productor());
    renderizar({ pathname: "/productores/120", state: { creado: true } });
    const usuario = userEvent.setup();
    expect(await screen.findByText("Productor creado con el código P-0120.")).toBeInTheDocument();

    await usuario.click(await screen.findByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(screen.queryByText(/Productor creado/)).not.toBeInTheDocument());
    expect(estadoHistorial()).toBeNull();
    expect(ubicacion()).toBe("/productores/120");
  });

  it("un productor que no existe: mensaje del servidor; un id que no es número no llama a la API", async () => {
    const llamada = vi.fn();
    servidor.use(
      http.get(`${API}/productores/:id`, ({ params }) => {
        llamada(params.id);
        return HttpResponse.json({ codigo: "no_encontrado", mensaje: "El productor no existe" }, { status: 404 });
      }),
      http.get(`${API}/productores/:id/recolecciones`, () =>
        HttpResponse.json({ codigo: "no_encontrado", mensaje: "El productor no existe" }, { status: 404 })),
    );
    renderizar("/productores/999");
    expect(await screen.findByRole("alert")).toHaveTextContent("El productor no existe");
    expect(llamada).toHaveBeenCalledWith("999");
  });

  it("un id que no es número no llama a la API", async () => {
    const llamada = vi.fn();
    servidor.use(http.get(`${API}/productores/:id`, () => {
      llamada();
      return HttpResponse.json(productor());
    }));
    renderizar("/productores/abc");
    expect(await screen.findByRole("alert")).toHaveTextContent("El productor no existe");
    expect(llamada).not.toHaveBeenCalled();
  });
});

describe("estadoPago (orden de prioridad)", () => {
  const base = { anulada_en: null, liquidada: false, retenida: false, pagable: false };
  it.each([
    [{ ...base, anulada_en: "2026-10-14T09:00:00-05:00", liquidada: true }, "Anulada"],
    [{ ...base, liquidada: true, retenida: true }, "Liquidada"],
    [{ ...base, retenida: true, pagable: true }, "Retenida"],
    [{ ...base, pagable: true }, "Pagable"],
    [base, "Por revisar"],
  ])("%j → %s", (datos, texto) => {
    expect(estadoPago(datos).texto).toBe(texto);
  });
});
