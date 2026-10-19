import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Acopiador, Asignacion, Asignar, Ruta, RutaCambios } from "../../api/tipos";
import { respuestaLogin } from "../../pruebas/datos";
import { acopiador, asignacion, dispositivo, ruta } from "../../pruebas/fabricas";
import { estadoHistorial, renderizar, ubicacion } from "../../pruebas/renderizar";
import { API, servidor } from "../../pruebas/servidor";
import { guardarSesion } from "../../sesion/almacen";

const ANA = acopiador({ id: 8, nombre_completo: "Ana Quispe Flores", color_hex: "#16A34A" });
const INACTIVO = acopiador({ id: 9, nombre_completo: "Pedro Inactivo", activo: false });

beforeEach(() => {
  guardarSesion(respuestaLogin());
  // 23:30 del 18/10 en Lima = 04:30 UTC del 19/10: "hoy" debe ser el 18
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 19, 4, 30));
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * API simulada de la ruta 21: GET/PATCH de la ruta, historial, PUT y DELETE del acopiador. Lleva el estado
 * como el servidor (cierra la vigente al reasignar o quitar) y registra lo que se envió.
 */
function simular(inicial: Ruta, historialInicial: Asignacion[] = inicial.acopiador_id != null ? [asignacion()] : []) {
  let actual = inicial;
  let historial = historialInicial;
  const enviado = { patch: [] as RutaCambios[], put: [] as Asignar[], deletes: 0 };
  const acopiadores = [acopiador(), ANA, INACTIVO];
  servidor.use(
    http.get(`${API}/rutas/${inicial.id}`, () => HttpResponse.json(actual)),
    http.patch(`${API}/rutas/${inicial.id}`, async ({ request }) => {
      const cambios = (await request.json()) as RutaCambios;
      enviado.patch.push(cambios);
      actual = { ...actual, ...(cambios as Partial<Ruta>) };
      return HttpResponse.json(actual);
    }),
    http.get(`${API}/rutas/${inicial.id}/asignaciones`, () => HttpResponse.json(historial)),
    http.get(`${API}/acopiadores`, () => HttpResponse.json(acopiadores)),
    http.put(`${API}/rutas/${inicial.id}/acopiador`, async ({ request }) => {
      const datos = (await request.json()) as Asignar;
      enviado.put.push(datos);
      const elegido = acopiadores.find((a) => a.id === datos.acopiador_id)!;
      const nueva = asignacion({ id: 400 + enviado.put.length, acopiador_id: elegido.id, acopiador: elegido.nombre_completo,
                                 vigente_desde: datos.desde! });
      historial = [nueva, ...historial.map((a) => (a.vigente_hasta === null ? { ...a, vigente_hasta: datos.desde! } : a))];
      actual = { ...actual, acopiador_id: elegido.id, acopiador: elegido.nombre_completo, color_hex: elegido.color_hex };
      return HttpResponse.json(nueva);
    }),
    http.delete(`${API}/rutas/${inicial.id}/acopiador`, () => {
      enviado.deletes += 1;
      historial = historial.map((a) => (a.vigente_hasta === null ? { ...a, vigente_hasta: "2026-10-18" } : a));
      actual = { ...actual, acopiador_id: null, acopiador: null, color_hex: null };
      return HttpResponse.json(historial[0]);
    }),
  );
  return enviado;
}

type Usuario = ReturnType<typeof userEvent.setup>;

async function abrirAsignar(usuario: Usuario, boton = "Cambiar acopiador") {
  await usuario.click(await screen.findByRole("button", { name: boton }));
  const ventana = screen.getByRole("dialog");
  await within(ventana).findByLabelText("Acopiador");
  return ventana;
}

describe("detalle de la ruta", () => {
  it("muestra datos, acopiador vigente con su fecha e historial (la vigente primero)", async () => {
    simular(ruta(), [
      asignacion(),
      asignacion({ id: 300, acopiador_id: 8, acopiador: "Ana Quispe Flores", vigente_desde: "2026-08-01",
                   vigente_hasta: "2026-09-18" }),
    ]);
    renderizar("/rutas/21");

    expect(await screen.findByRole("heading", { name: "Ruta 4 - Collana" })).toBeInTheDocument();
    expect(screen.getByLabelText("Descripción (opcional)")).toHaveValue("Collana y Yanamayo");
    const seccion = screen.getByRole("heading", { name: "Acopiador vigente" }).closest("section")!;
    expect(within(seccion).getByRole("link", { name: "Juan Carlos Mamani Quispe" })).toHaveAttribute("href", "/acopiadores/7");
    expect(await within(seccion).findByText("desde 18/09/2026")).toBeInTheDocument();

    const filas = within(screen.getByRole("heading", { name: "Historial de asignaciones" }).closest("section")!)
      .getAllByRole("row").slice(1).map((f) => f.textContent);
    expect(filas).toEqual(["Juan Carlos Mamani Quispe18/09/2026Vigente", "Ana Quispe Flores01/08/202618/09/2026"]);
    await waitFor(() => expect(document.title).toBe("Ruta 4 - Collana · Quesería Huata"));
  });

  it("guardar envía solo lo que cambió; descripción vacía como null", async () => {
    const enviado = simular(ruta());
    renderizar("/rutas/21");
    const usuario = userEvent.setup();

    await usuario.clear(await screen.findByLabelText("Descripción (opcional)"));
    await usuario.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByText("Cambios guardados.")).toBeInTheDocument();
    expect(enviado.patch).toEqual([{ descripcion: null }]);
  });

  it("desactivar: avisa qué ve el celular, que la asignación se mantiene, y envía solo activa=false", async () => {
    const enviado = simular(ruta());
    renderizar("/rutas/21");
    const usuario = userEvent.setup();

    await usuario.click(await screen.findByRole("button", { name: "Desactivar ruta" }));
    const ventana = screen.getByRole("dialog", { name: "Desactivar ruta" });
    expect(ventana).toHaveTextContent(
      "Juan Carlos Mamani Quispe deja de verla en su celular, junto con sus productores, en su próxima sincronización.");
    expect(ventana).toHaveTextContent("Lo que tenga sin enviar se sube igual.");
    expect(ventana).toHaveTextContent("la asignación no cambia: al reactivarla, vuelven a su celular.");

    await usuario.click(within(ventana).getByRole("button", { name: "Desactivar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(enviado.patch).toEqual([{ activa: false }]);
    expect(screen.getByText("Inactiva")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reactivar ruta" })).toBeInTheDocument();
  });

  it("reactivar dice en qué celular vuelve a aparecer y envía solo activa=true", async () => {
    const enviado = simular(ruta({ activa: false }));
    renderizar("/rutas/21");
    const usuario = userEvent.setup();

    await usuario.click(await screen.findByRole("button", { name: "Reactivar ruta" }));
    const ventana = screen.getByRole("dialog", { name: "Reactivar ruta" });
    expect(ventana)
      .toHaveTextContent("Vuelve a aparecer en el celular de Juan Carlos Mamani Quispe en su próxima sincronización.");

    await usuario.click(within(ventana).getByRole("button", { name: "Reactivar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(enviado.patch).toEqual([{ activa: true }]);
    expect(screen.getByRole("button", { name: "Desactivar ruta" })).toBeInTheDocument();
  });

  it("desactivar una ruta sin acopiador no habla de ningún celular que la pierda", async () => {
    simular(ruta({ acopiador_id: null, acopiador: null, color_hex: null }));
    renderizar("/rutas/21");

    await userEvent.setup().click(await screen.findByRole("button", { name: "Desactivar ruta" }));
    const ventana = screen.getByRole("dialog", { name: "Desactivar ruta" });
    expect(ventana).toHaveTextContent("No tiene acopiador: ningún celular la ve ahora.");
    expect(ventana).not.toHaveTextContent("deja de verla");
  });

  describe("asignar o cambiar acopiador", () => {
    it("lista solo acopiadores activos que no son el actual", async () => {
      simular(ruta());
      renderizar("/rutas/21");
      const ventana = await abrirAsignar(userEvent.setup());

      const opciones = within(ventana).getAllByRole("option").map((o) => o.textContent);
      expect(opciones).toEqual(["Elija…", "Ana Quispe Flores"]);
    });

    it("la fecha va de hoy en Lima, con límites de los datos y la ayuda pegada al campo", async () => {
      simular(ruta());
      renderizar("/rutas/21");
      const ventana = await abrirAsignar(userEvent.setup());

      const desde = within(ventana).getByLabelText("Desde");
      expect(desde).toHaveValue("2026-10-18");                 // 23:30 en Lima: sigue siendo el 18
      expect(desde).toHaveAttribute("min", "2026-09-18");      // inicio de la asignación vigente
      expect(desde).toHaveAttribute("max", "2026-10-18");      // hoy en Lima
      expect(desde).toHaveAccessibleDescription("La fecha queda en el historial; el cambio rige desde que se guarda.");
    });

    it("cambiar: envía {acopiador_id, desde}, explica qué pasa con cada celular y recarga ruta e historial", async () => {
      const enviado = simular(ruta());
      renderizar("/rutas/21");
      const usuario = userEvent.setup();
      const ventana = await abrirAsignar(usuario);

      expect(ventana).toHaveAccessibleName("Cambiar acopiador");
      await usuario.selectOptions(within(ventana).getByLabelText("Acopiador"), "Ana Quispe Flores");
      fireEvent.change(within(ventana).getByLabelText("Desde"), { target: { value: "2026-10-01" } });
      expect(ventana).toHaveTextContent(
        "Ana Quispe Flores recibe esta ruta y sus productores en su celular en su próxima sincronización.");
      expect(ventana).toHaveTextContent(
        "Juan Carlos Mamani Quispe deja de verlos en la suya. Lo que tenga sin enviar se sube igual y queda a su nombre.");

      await usuario.click(within(ventana).getByRole("button", { name: "Cambiar" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(enviado.put).toEqual([{ acopiador_id: 8, desde: "2026-10-01" }]);

      const seccion = screen.getByRole("heading", { name: "Acopiador vigente" }).closest("section")!;
      expect(await within(seccion).findByRole("link", { name: "Ana Quispe Flores" })).toBeInTheDocument();
      expect(await within(seccion).findByText("desde 01/10/2026")).toBeInTheDocument();
      // La nueva abre el 01/10 y la anterior se cierra ese mismo día
      const historial = screen.getByRole("heading", { name: "Historial de asignaciones" }).closest("section")!;
      await waitFor(() => expect(within(historial).getAllByRole("row").slice(1).map((f) => f.textContent))
        .toEqual(["Ana Quispe Flores01/10/2026Vigente", "Juan Carlos Mamani Quispe18/09/202601/10/2026"]));
    });

    it.each([
      ["2026-10-19", "No puede ser posterior a hoy (18/10/2026)"],
      ["2026-09-17", "No puede ser anterior al 18/09/2026, el inicio de la asignación vigente"],
      ["", "Elija la fecha"],
    ])("fecha %j fuera de rango: '%s' y no envía", async (valor, mensaje) => {
      const enviado = simular(ruta());
      renderizar("/rutas/21");
      const usuario = userEvent.setup();
      const ventana = await abrirAsignar(usuario);

      await usuario.selectOptions(within(ventana).getByLabelText("Acopiador"), "Ana Quispe Flores");
      fireEvent.change(within(ventana).getByLabelText("Desde"), { target: { value: valor } });
      await usuario.click(within(ventana).getByRole("button", { name: "Cambiar" }));

      expect(within(ventana).getByLabelText("Desde")).toHaveAccessibleDescription(new RegExp(`^${mensaje.replace(/[()]/g, "\\$&")}`));
      expect(enviado.put).toEqual([]);
    });

    it("sin elegir acopiador no envía", async () => {
      const enviado = simular(ruta());
      renderizar("/rutas/21");
      const usuario = userEvent.setup();
      const ventana = await abrirAsignar(usuario);

      await usuario.click(within(ventana).getByRole("button", { name: "Cambiar" }));
      expect(within(ventana).getByLabelText("Acopiador")).toHaveAccessibleDescription("Elija un acopiador");
      expect(enviado.put).toEqual([]);
    });

    it("ruta sin acopiador: 'Asignar', sin texto del anterior, y mínimo = cierre de la última asignación", async () => {
      simular(ruta({ acopiador_id: null, acopiador: null, color_hex: null }),
              [asignacion({ vigente_desde: "2026-08-01", vigente_hasta: "2026-09-30" })]);
      renderizar("/rutas/21");
      const usuario = userEvent.setup();
      expect(await screen.findByText("Ningún celular ve los productores de esta ruta.", { exact: false })).toBeInTheDocument();
      const ventana = await abrirAsignar(usuario, "Asignar acopiador");

      expect(ventana).toHaveAccessibleName("Asignar acopiador");
      expect(within(ventana).getAllByRole("option").map((o) => o.textContent))
        .toEqual(["Elija…", "Juan Carlos Mamani Quispe", "Ana Quispe Flores"]);
      expect(within(ventana).getByLabelText("Desde")).toHaveAttribute("min", "2026-09-30");
      expect(ventana).not.toHaveTextContent("deja de verlos");
    });

    it("ruta inactiva: avisa que no aparecerá en ningún celular hasta reactivarla", async () => {
      simular(ruta({ activa: false }));
      renderizar("/rutas/21");
      const ventana = await abrirAsignar(userEvent.setup());

      expect(ventana).toHaveTextContent("La ruta está inactiva: no aparecerá en ningún celular hasta reactivarla.");
      expect(ventana).toHaveTextContent("Juan Carlos Mamani Quispe deja de tenerla asignada.");
      expect(ventana).not.toHaveTextContent("recibe esta ruta");
    });

    it("el error del servidor se muestra en la ventana", async () => {
      simular(ruta());
      servidor.use(http.put(`${API}/rutas/21/acopiador`, () => HttpResponse.json({
        codigo: "validacion", mensaje: "La fecha de cambio no puede ser anterior al inicio de la asignación vigente",
      }, { status: 422 })));
      renderizar("/rutas/21");
      const usuario = userEvent.setup();
      const ventana = await abrirAsignar(usuario);

      await usuario.selectOptions(within(ventana).getByLabelText("Acopiador"), "Ana Quispe Flores");
      await usuario.click(within(ventana).getByRole("button", { name: "Cambiar" }));
      expect(await within(ventana).findByRole("alert"))
        .toHaveTextContent("La fecha de cambio no puede ser anterior al inicio de la asignación vigente");
    });
  });

  it("quitar acopiador: confirma, llama a DELETE y la ruta queda sin acopiador", async () => {
    const enviado = simular(ruta());
    renderizar("/rutas/21");
    const usuario = userEvent.setup();

    await usuario.click(await screen.findByRole("button", { name: "Quitar acopiador" }));
    const ventana = screen.getByRole("dialog", { name: "Quitar acopiador" });
    expect(ventana).toHaveTextContent(
      "Juan Carlos Mamani Quispe deja de ver esta ruta y sus productores en su celular en su próxima sincronización.");
    expect(ventana).toHaveTextContent("En el historial se cierra con fecha de hoy.");

    await usuario.click(within(ventana).getByRole("button", { name: "Quitar acopiador" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(enviado.deletes).toBe(1);
    const seccion = screen.getByRole("heading", { name: "Acopiador vigente" }).closest("section")!;
    expect(await within(seccion).findByText("Sin acopiador")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quitar acopiador" })).not.toBeInTheDocument();
  });

  it("el aviso de 'Ruta creada' desaparece al asignar y no vuelve con F5", async () => {
    simular(ruta({ id: 21, acopiador_id: null, acopiador: null, color_hex: null }));
    renderizar({ pathname: "/rutas/21", state: { creado: true } });
    const usuario = userEvent.setup();
    const AVISO = "Ruta creada. Todavía no tiene acopiador: asígnelo más abajo.";
    expect(await screen.findByText(AVISO)).toBeInTheDocument();

    const ventana = await abrirAsignar(usuario, "Asignar acopiador");
    await usuario.selectOptions(within(ventana).getByLabelText("Acopiador"), "Ana Quispe Flores");
    await usuario.click(within(ventana).getByRole("button", { name: "Asignar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();
    expect(estadoHistorial()).toBeNull();
    expect(ubicacion()).toBe("/rutas/21");
  });

  it("una ruta que no existe: mensaje del servidor; un id que no es número no llama a la API", async () => {
    const llamada = vi.fn();
    servidor.use(http.get(`${API}/rutas/:id`, ({ params }) => {
      llamada(params.id);
      return HttpResponse.json({ codigo: "no_encontrado", mensaje: "La ruta no existe" }, { status: 404 });
    }));
    renderizar("/rutas/999");
    expect(await screen.findByRole("alert")).toHaveTextContent("La ruta no existe");
    expect(llamada).toHaveBeenCalledWith("999");
  });

  it("un id que no es número no llama a la API", async () => {
    const llamada = vi.fn();
    servidor.use(http.get(`${API}/rutas/:id`, () => {
      llamada();
      return HttpResponse.json(ruta());
    }));
    renderizar("/rutas/abc");
    expect(await screen.findByRole("alert")).toHaveTextContent("La ruta no existe");
    expect(llamada).not.toHaveBeenCalled();
  });
});

it("el detalle del acopiador enlaza cada ruta vigente a su detalle", async () => {
  guardarSesion(respuestaLogin());
  servidor.use(
    http.get(`${API}/acopiadores/7`, () => HttpResponse.json(acopiador() satisfies Acopiador)),
    http.get(`${API}/usuarios/7/dispositivos`, () => HttpResponse.json([dispositivo()])),
  );
  renderizar("/acopiadores/7");
  expect(await screen.findByRole("link", { name: "Ruta 1 - Huata Centro" })).toHaveAttribute("href", "/rutas/1");
});
