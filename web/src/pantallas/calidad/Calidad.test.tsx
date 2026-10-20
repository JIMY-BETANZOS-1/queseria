import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import type { CalidadAdmin, RecoleccionDetalle } from "../../api/tipos";
import { respuestaLogin } from "../../pruebas/datos";
import { recoleccion } from "../../pruebas/fabricas";
import { irPorMenu } from "../../pruebas/menu";
import { renderizar, ubicacion } from "../../pruebas/renderizar";
import { API, servidor } from "../../pruebas/servidor";
import { guardarSesion } from "../../sesion/almacen";

beforeEach(() => {
  guardarSesion(respuestaLogin());
});

const id = (n: number) => `0f6c2a4e-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ROSA = recoleccion({ recoleccion_id: id(1), revisada: false, pagable: false, registrada_en: "2026-10-17T06:10:00-05:00" });
const PEDRO = recoleccion({ recoleccion_id: id(2), revisada: false, pagable: false, productor: "Pedro Quispe", productor_id: 121,
                            productor_codigo: "P-0121", registrada_en: "2026-10-17T06:30:00-05:00", alertas_pendientes: 1,
                            retenida: true });
const LUCIA = recoleccion({ recoleccion_id: id(3), revisada: false, pagable: false, productor: "Lucía Mamani", productor_id: 123,
                            registrado_por: 8, registrado_por_nombre: "Ana Quispe Flores", color_hex: "#16A34A",
                            registrada_en: "2026-10-18T07:00:00-05:00" });

/** API simulada: lista por revisar y revisar (con respuestas especiales por id). */
function simular(lista: RecoleccionDetalle[], especiales: Record<string, () => Response> = {}) {
  const enviados: { id: string; cuerpo: CalidadAdmin }[] = [];
  servidor.use(
    http.get(`${API}/recolecciones/sin-revisar`, () => HttpResponse.json(lista)),
    http.post(`${API}/recolecciones/:id/calidad`, async ({ params, request }) => {
      const cuerpo = (await request.json()) as CalidadAdmin;
      enviados.push({ id: String(params.id), cuerpo });
      const especial = especiales[String(params.id)];
      if (especial) return especial();
      const r = lista.find((x) => x.recoleccion_id === params.id)!;
      return HttpResponse.json({
        recoleccion: { ...r, revisada: true, estado_calidad: cuerpo.estado },
        sancion: cuerpo.estado === "alterado" ? { tipo: "precio", desde: "2026-10-19", hasta: "2026-10-25" } : null,
      });
    }),
  );
  return enviados;
}

function filas(): string[] {
  return screen.getAllByRole("row").slice(1).map((f) => within(f).getByRole("link", { name: /Quispe|Condori|Mamani/ }).textContent ?? "");
}

describe("calidad: por revisar", () => {
  it("el menú lleva a Calidad; lista de la más antigua a la más reciente, con su estado de pago", async () => {
    simular([ROSA, PEDRO, LUCIA]);
    renderizar("/");
    await irPorMenu(userEvent.setup(), "Revisión", "Calidad");

    expect(ubicacion()).toBe("/calidad");
    expect(await screen.findByText("Rosa Condori Huanca")).toBeInTheDocument();
    expect(filas()).toEqual(["Rosa Condori Huanca", "Pedro Quispe", "Lucía Mamani"]);
    expect(within(screen.getByRole("link", { name: "Pedro Quispe" }).closest("tr")!).getByText("Retenida")).toBeInTheDocument();
    expect(within(screen.getByRole("link", { name: "Rosa Condori Huanca" }).closest("tr")!).getByText("Por revisar")).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Calidad · Quesería Huata"));
  });

  it("filtra por quién registró", async () => {
    simular([ROSA, PEDRO, LUCIA]);
    renderizar("/calidad");
    await screen.findByText("Rosa Condori Huanca");

    // Filtro como botones con contador: Todos 3 · Ana 1 · Juan Carlos 2
    const grupo = screen.getByRole("group", { name: "Registró" });
    expect(within(grupo).getAllByRole("button").map((b) => [b.firstChild?.textContent, b.querySelector(".contador")?.textContent]))
      .toEqual([["Todos", "3"], ["Ana Quispe Flores", "1"], ["Juan Carlos Mamani Quispe", "2"]]);
    await userEvent.setup().click(within(grupo).getByRole("button", { name: /^Ana Quispe Flores/ }));
    expect(within(grupo).getByRole("button", { name: /^Ana Quispe Flores/ })).toHaveAttribute("aria-pressed", "true");
    expect(filas()).toEqual(["Lucía Mamani"]);
    await userEvent.setup().click(within(grupo).getByRole("button", { name: /^Todos/ }));
    expect(filas()).toEqual(["Rosa Condori Huanca", "Pedro Quispe", "Lucía Mamani"]);
  });

  it("etiquetas con ícono (pago y pendiente de aprobación) y fecha corta en la celda", async () => {
    simular([ROSA, { ...PEDRO, productor_pendiente: true }]);
    renderizar("/calidad");
    await screen.findByText("Rosa Condori Huanca");
    const pedro = within(screen.getByRole("link", { name: "Pedro Quispe" }).closest("tr")!);
    expect(pedro.getByText("Retenida")).toHaveClass("insignia-error");
    expect(pedro.getByText("Retenida").querySelector("svg.icono-estado")).toHaveAttribute("aria-hidden", "true");
    expect(pedro.getByText("Pendiente de aprobación").querySelector("svg.icono-estado")).not.toBeNull();
    expect(pedro.getAllByRole("cell")[1]).toHaveTextContent(/^17\/10 06:30$/);
    expect(pedro.getByRole("checkbox")).toHaveAccessibleName("Seleccionar Pedro Quispe 17/10/2026 06:30");
  });

  it("marcar normales: confirma qué pasa, revisa una por una con estado normal y las quita de la lista", async () => {
    const enviados = simular([ROSA, PEDRO, LUCIA]);
    renderizar("/calidad");
    const usuario = userEvent.setup();
    await screen.findByText("Rosa Condori Huanca");
    expect(screen.getByRole("button", { name: "Marcar normales (0)" })).toBeDisabled();

    await usuario.click(screen.getByLabelText(/Seleccionar Rosa Condori Huanca/));
    await usuario.click(screen.getByLabelText(/Seleccionar Pedro Quispe/));
    await usuario.click(screen.getByRole("button", { name: "Marcar normales (2)" }));
    const ventana = screen.getByRole("dialog", { name: "Marcar 2 como normales" });
    expect(ventana).toHaveTextContent("pasan a pagables, salvo las retenidas (productor no aprobado o alerta que retiene sin revisar)");
    expect(ventana).toHaveTextContent("No se puede deshacer desde el panel.");

    await usuario.click(within(ventana).getByRole("button", { name: "Marcar normal" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(enviados).toEqual([{ id: id(1), cuerpo: { estado: "normal" } }, { id: id(2), cuerpo: { estado: "normal" } }]);
    expect(screen.getByRole("status")).toHaveTextContent("2 entregas marcadas como normales.");
    expect(filas()).toEqual(["Lucía Mamani"]);
  });

  it("si alguna falla, se informa y queda en la lista; las demás se revisan", async () => {
    simular([ROSA, PEDRO], {
      [id(2)]: () => HttpResponse.json({ codigo: "conflicto", mensaje: "La recolección está anulada" }, { status: 409 }),
    });
    renderizar("/calidad");
    const usuario = userEvent.setup();
    await screen.findByText("Rosa Condori Huanca");

    await usuario.click(screen.getByLabelText("Seleccionar todas las visibles"));
    await usuario.click(screen.getByRole("button", { name: "Marcar normales (2)" }));
    await usuario.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Marcar normal" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudieron revisar: Pedro Quispe (17/10/2026 06:30): La recolección está anulada");
    expect(screen.getByRole("status")).toHaveTextContent("1 entrega marcada como normal.");
    expect(filas()).toEqual(["Pedro Quispe"]);
  });

  describe("alterada", () => {
    async function abrir(usuario: ReturnType<typeof userEvent.setup>, productor: string) {
      await usuario.click(within(screen.getByRole("link", { name: productor }).closest("tr")!).getByRole("button", { name: "Alterada…" }));
      return screen.getByRole("dialog", { name: "Marcar como alterada" });
    }

    it("explica descarte, pago y sanción; exige al menos un dato del análisis y que sean números", async () => {
      const enviados = simular([ROSA]);
      renderizar("/calidad");
      const usuario = userEvent.setup();
      await screen.findByText("Rosa Condori Huanca");

      const ventana = await abrir(usuario, "Rosa Condori Huanca");
      expect(ventana).toHaveTextContent("La leche alterada se descarta. Su pago sigue la configuración \"Pagar leche alterada\"");
      expect(ventana).toHaveTextContent("queda sancionado desde mañana con el precio de sanción");
      expect(ventana).toHaveTextContent("queda bloqueado");
      const boton = within(ventana).getByRole("button", { name: "Marcar alterada" });
      expect(boton).toHaveClass("boton-peligro");

      await usuario.click(boton);
      expect(within(ventana).getByRole("alert")).toHaveTextContent("Escriba al menos un dato del análisis");
      await usuario.type(within(ventana).getByLabelText("pH"), "6,1");
      await usuario.click(boton);
      expect(within(ventana).getByLabelText("pH")).toHaveAccessibleDescription("Escriba un número (con punto decimal)");
      expect(enviados).toEqual([]);
    });

    it("envía el análisis y avisa la sanción que creó la base", async () => {
      const enviados = simular([ROSA, LUCIA]);
      renderizar("/calidad");
      const usuario = userEvent.setup();
      await screen.findByText("Rosa Condori Huanca");

      const ventana = await abrir(usuario, "Rosa Condori Huanca");
      await usuario.type(within(ventana).getByLabelText("pH"), "6.1");
      await usuario.selectOptions(within(ventana).getByLabelText("Antibióticos"), "Positivo");
      await usuario.click(within(ventana).getByRole("button", { name: "Marcar alterada" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(enviados).toEqual([{ id: id(1), cuerpo: { estado: "alterado", ph: 6.1, antibioticos_positivo: true } }]);
      expect(screen.getByRole("status")).toHaveTextContent(
        "Entrega de Rosa Condori Huanca marcada como alterada. La base creó una sanción de precio del 19/10/2026 al 25/10/2026.");
      expect(filas()).toEqual(["Lucía Mamani"]);
    });

    function simularFoto(respuesta?: () => Response) {
      const orden: string[] = [];
      const fotos: { id: string; multipart: boolean; tipo: string; contenido: string }[] = [];
      servidor.use(http.post(`${API}/analisis/:id/foto`, async ({ params, request }) => {
        orden.push("foto");
        const multipart = (request.headers.get("content-type") ?? "").startsWith("multipart/form-data");
        const archivo = (await request.formData()).get("archivo") as File;
        // El nombre del archivo no sobrevive al paso de jsdom a fetch de Node (llega "blob"); en el navegador sí va
        fotos.push({ id: String(params.id), multipart, tipo: archivo.type, contenido: await archivo.text() });
        return respuesta?.() ?? HttpResponse.json({ recoleccion_id: params.id, foto_url: "fotos/x.jpg" });
      }));
      return { orden, fotos };
    }

    it("con solo una foto: la sube primero (multipart) y luego marca alterada sin otros datos", async () => {
      const enviados = simular([ROSA]);
      const { orden, fotos } = simularFoto();
      servidor.use(http.post(`${API}/recolecciones/:id/calidad`, async ({ request }) => {
        orden.push("calidad");
        const cuerpo = (await request.json()) as CalidadAdmin;
        enviados.push({ id: id(1), cuerpo });
        return HttpResponse.json({ recoleccion: { ...ROSA, revisada: true, estado_calidad: "alterado" }, sancion: null });
      }));
      renderizar("/calidad");
      const usuario = userEvent.setup();
      await screen.findByText("Rosa Condori Huanca");

      const ventana = await abrir(usuario, "Rosa Condori Huanca");
      expect(within(ventana).getByLabelText("Foto (opcional)")).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
      await usuario.upload(within(ventana).getByLabelText("Foto (opcional)"),
                           new File(["imagen"], "leche-cortada.jpg", { type: "image/jpeg" }));
      expect(ventana).toHaveTextContent("Foto elegida: leche-cortada.jpg (1 KB). Se sube al marcar alterada.");
      await usuario.click(within(ventana).getByRole("button", { name: "Marcar alterada" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(orden).toEqual(["foto", "calidad"]);
      expect(fotos).toEqual([{ id: id(1), multipart: true, tipo: "image/jpeg", contenido: "imagen" }]);
      expect(enviados).toEqual([{ id: id(1), cuerpo: { estado: "alterado" } }]);
    });

    it("un archivo que no es imagen no se acepta y no se envía nada", async () => {
      const enviados = simular([ROSA]);
      const { fotos } = simularFoto();
      renderizar("/calidad");
      const usuario = userEvent.setup();
      await screen.findByText("Rosa Condori Huanca");
      const ventana = await abrir(usuario, "Rosa Condori Huanca");
      fireEvent.change(within(ventana).getByLabelText("Foto (opcional)"),
                       { target: { files: [new File(["texto"], "notas.txt", { type: "text/plain" })] } });
      expect(within(ventana).getByLabelText("Foto (opcional)")).toHaveAccessibleDescription(
        /^La foto debe ser una imagen JPEG, PNG o WebP/);
      await usuario.click(within(ventana).getByRole("button", { name: "Marcar alterada" }));
      expect(fotos).toEqual([]);
      expect(enviados).toEqual([]);
    });

    it("si la foto no se puede subir (p. ej. muy grande), no marca alterada y muestra el mensaje", async () => {
      const enviados = simular([ROSA]);
      simularFoto(() => HttpResponse.json({ codigo: "muy_grande", mensaje: "La foto supera el límite de 5 MB" }, { status: 413 }));
      renderizar("/calidad");
      const usuario = userEvent.setup();
      await screen.findByText("Rosa Condori Huanca");
      const ventana = await abrir(usuario, "Rosa Condori Huanca");
      await usuario.type(within(ventana).getByLabelText("pH"), "6.1");
      await usuario.upload(within(ventana).getByLabelText("Foto (opcional)"), new File(["x"], "grande.png", { type: "image/png" }));
      await usuario.click(within(ventana).getByRole("button", { name: "Marcar alterada" }));
      expect(await within(ventana).findByRole("alert")).toHaveTextContent("La foto supera el límite de 5 MB");
      expect(enviados).toEqual([]);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("el error de la base se muestra en la ventana", async () => {
      simular([ROSA], {
        [id(1)]: () => HttpResponse.json({ codigo: "validacion", mensaje: "El pH debe estar entre 0 y 14" }, { status: 422 }),
      });
      renderizar("/calidad");
      const usuario = userEvent.setup();
      await screen.findByText("Rosa Condori Huanca");

      const ventana = await abrir(usuario, "Rosa Condori Huanca");
      await usuario.type(within(ventana).getByLabelText("pH"), "15");
      await usuario.click(within(ventana).getByRole("button", { name: "Marcar alterada" }));
      expect(await within(ventana).findByRole("alert")).toHaveTextContent("El pH debe estar entre 0 y 14");
    });
  });

  it("sin pendientes lo dice", async () => {
    simular([]);
    renderizar("/calidad");
    expect(await screen.findByText("No hay entregas por revisar.")).toBeInTheDocument();
    const vacio = screen.getByText("No hay entregas por revisar.").closest(".vacio-bloque");
    expect(vacio).not.toBeNull();
    expect(vacio!.querySelector("svg.vacio-icono")).toHaveAttribute("aria-hidden", "true");
  });
});
