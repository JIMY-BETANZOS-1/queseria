import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProductorNuevo as DatosNuevo, ProductorResumen } from "../../api/tipos";
import { respuestaLogin } from "../../pruebas/datos";
import { productor, productorResumen, ruta } from "../../pruebas/fabricas";
import { renderizar, ubicacion } from "../../pruebas/renderizar";
import { API, servidor } from "../../pruebas/servidor";
import { guardarSesion } from "../../sesion/almacen";

const RUTAS = [ruta(), ruta({ id: 22, nombre: "Ruta 5 - Capachica" }), ruta({ id: 23, nombre: "Ruta vieja", activa: false })];

beforeEach(() => {
  guardarSesion(respuestaLogin());
  servidor.use(http.get(`${API}/rutas`, () => HttpResponse.json(RUTAS)));
});

/** Responde la lista y guarda la consulta que pidió la pantalla. */
function lista(productores: ProductorResumen[]) {
  const consultas: string[] = [];
  servidor.use(http.get(`${API}/productores`, ({ request }) => {
    consultas.push(new URL(request.url).search);
    return HttpResponse.json(productores);
  }));
  return consultas;
}

function fila(nombre: string): HTMLElement {
  return screen.getByRole("link", { name: nombre }).closest("tr")!;
}

function nombres(): string[] {
  return screen.queryAllByRole("row").slice(1).map((f) => within(f).getByRole("link").textContent ?? "");
}

describe("lista de productores", () => {
  const PENDIENTE = productorResumen({ productor_id: 1, codigo: "P-0201", nombre: "Alta Campo", pendiente_aprobacion: true,
                                       litros_total: 30, litros_descartados: 0 });
  const DE_RUTA = productorResumen({ productor_id: 2, codigo: "P-0120", nombre: "Rosa Condori Huanca" });
  const EXTERNO = productorResumen({ productor_id: 3, codigo: "P-0300", nombre: "Lácteos del Lago", tipo: "externo", ruta_id: null,
                                     acopiador: null, color_hex: "#6B7280" });
  const OTRA_RUTA = productorResumen({ productor_id: 4, codigo: "P-0400", nombre: "Pedro Capachica", ruta_id: 22,
                                       sancionado: true, sancion_hasta: "2026-10-24" });
  const BLOQUEADO = productorResumen({ productor_id: 5, codigo: "P-0500", nombre: "Bloqueado Uno", sancionado: true,
                                       bloqueado: true, sancion_hasta: "2026-10-22" });
  const INACTIVO = productorResumen({ productor_id: 6, codigo: "P-0600", nombre: "Inactivo Seis", activo: false });
  const TODOS = [PENDIENTE, DE_RUTA, EXTERNO, OTRA_RUTA, BLOQUEADO, INACTIVO];

  it("el menú lleva a Productores; pide también los inactivos y respeta el orden del servidor", async () => {
    const consultas = lista(TODOS);
    renderizar("/");
    await userEvent.setup().click(
      within(screen.getByRole("navigation", { name: "Menú principal" })).getByRole("link", { name: "Productores" }));

    expect(ubicacion()).toBe("/productores");
    expect(await screen.findByRole("link", { name: "Alta Campo" })).toHaveAttribute("href", "/productores/1");
    expect(consultas).toEqual(["?incluir_inactivos=true"]);
    expect(nombres()).toEqual(["Alta Campo", "Rosa Condori Huanca", "Lácteos del Lago", "Pedro Capachica", "Bloqueado Uno"]);
    await waitFor(() => expect(document.title).toBe("Productores · Quesería Huata"));
  });

  it("muestra ruta, acopiador, litros, última entrega e insignias de estado", async () => {
    lista(TODOS);
    renderizar("/productores");
    await screen.findByRole("link", { name: "Rosa Condori Huanca" });

    const rosa = within(fila("Rosa Condori Huanca"));
    expect(rosa.getByText("P-0120")).toBeInTheDocument();
    expect(await rosa.findByText("Ruta 4 - Collana")).toBeInTheDocument();
    expect(rosa.getByText(/Juan Carlos Mamani Quispe/)).toBeInTheDocument();
    expect(rosa.getByText("1,234.5 L")).toBeInTheDocument();
    expect(rosa.getByText("18/10/2026 06:15")).toBeInTheDocument();
    expect(within(fila("Lácteos del Lago")).getByText("Externo")).toBeInTheDocument();
    expect(within(fila("Alta Campo")).getByText("Pendiente de aprobación")).toBeInTheDocument();
    expect(within(fila("Pedro Capachica")).getByText("Sancionado hasta 24/10/2026")).toBeInTheDocument();
    expect(within(fila("Bloqueado Uno")).getByText("Bloqueado hasta 22/10/2026")).toBeInTheDocument();
    expect(within(fila("Bloqueado Uno")).queryByText(/Sancionado/)).not.toBeInTheDocument();
  });

  it("avisa cuántas altas están pendientes y permite ver solo esas; no se aprueba desde la lista", async () => {
    lista(TODOS);
    renderizar("/productores");
    const usuario = userEvent.setup();

    expect(await screen.findByText(/1 alta de campo pendiente de aprobación/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Aprobar/ })).not.toBeInTheDocument();
    await usuario.click(screen.getByRole("button", { name: "Ver solo pendientes" }));
    expect(nombres()).toEqual(["Alta Campo"]);
    expect(screen.getByLabelText("Solo pendientes")).toBeChecked();
  });

  it("filtra por tipo, ruta, búsqueda (nombre o código) e inactivos", async () => {
    lista(TODOS);
    renderizar("/productores");
    const usuario = userEvent.setup();
    await screen.findByRole("link", { name: "Alta Campo" });

    await usuario.selectOptions(screen.getByLabelText("Tipo"), "Externo (llega a planta)");
    expect(nombres()).toEqual(["Lácteos del Lago"]);
    await usuario.selectOptions(screen.getByLabelText("Tipo"), "Todos");

    await usuario.selectOptions(screen.getByLabelText("Ruta"), "Ruta 5 - Capachica");
    expect(nombres()).toEqual(["Pedro Capachica"]);
    await usuario.selectOptions(screen.getByLabelText("Ruta"), "Todas");

    await usuario.type(screen.getByLabelText("Buscar"), "p-0300");
    expect(nombres()).toEqual(["Lácteos del Lago"]);
    await usuario.clear(screen.getByLabelText("Buscar"));
    await usuario.type(screen.getByLabelText("Buscar"), "rosa");
    expect(nombres()).toEqual(["Rosa Condori Huanca"]);
    await usuario.clear(screen.getByLabelText("Buscar"));

    await usuario.click(screen.getByLabelText("Mostrar inactivos"));
    expect(within(fila("Inactivo Seis")).getByText("Inactivo")).toBeInTheDocument();
    await usuario.type(screen.getByLabelText("Buscar"), "nadie");
    expect(screen.getByText("Ningún productor coincide con los filtros.")).toBeInTheDocument();
  });

  it("si la API falla, muestra el mensaje y permite reintentar", async () => {
    let fallar = true;
    servidor.use(http.get(`${API}/productores`, () => (fallar
      ? HttpResponse.json({ codigo: "error_interno", mensaje: "Error interno del servidor" }, { status: 500 })
      : HttpResponse.json([]))));
    renderizar("/productores");

    expect(await screen.findByRole("alert")).toHaveTextContent("Error interno del servidor");
    fallar = false;
    await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Todavía no hay productores.")).toBeInTheDocument();
  });
});

describe("nuevo productor", () => {
  /** Simula el POST y el detalle del creado; devuelve los cuerpos enviados. */
  function simularAlta() {
    const cuerpos: DatosNuevo[] = [];
    servidor.use(
      http.post(`${API}/productores`, async ({ request }) => {
        const datos = (await request.json()) as DatosNuevo;
        cuerpos.push(datos);
        return HttpResponse.json(productor({ ...datos, id: 150, codigo: "P-0150" } as never), { status: 201 });
      }),
      http.get(`${API}/productores/150`, () => HttpResponse.json(productor({ id: 150, codigo: "P-0150" }))),
      http.get(`${API}/productores/150/recolecciones`, () => HttpResponse.json([])),
    );
    return cuerpos;
  }

  it("de ruta: solo ofrece rutas activas y envía los vacíos como null", async () => {
    const cuerpos = simularAlta();
    renderizar("/productores/nuevo");
    const usuario = userEvent.setup();

    await usuario.type(await screen.findByLabelText("Nombre"), "  Ana Mamani ");
    const opciones = within(screen.getByLabelText("Ruta")).getAllByRole("option").map((o) => o.textContent);
    expect(opciones).toEqual(["Elija…", "Ruta 4 - Collana", "Ruta 5 - Capachica"]);
    await usuario.selectOptions(screen.getByLabelText("Ruta"), "Ruta 5 - Capachica");
    await usuario.click(screen.getByRole("button", { name: "Crear productor" }));

    await waitFor(() => expect(ubicacion()).toBe("/productores/150"));
    expect(cuerpos).toEqual([{ nombre: "Ana Mamani", documento: null, celular: null, tipo: "de_ruta", ruta_id: 22,
                               latitud_ref: null, longitud_ref: null }]);
    expect(await screen.findByText("Productor creado con el código P-0150.")).toBeInTheDocument();
  });

  it("externo: exige documento y celular, no lleva ruta, y envía la ubicación como números", async () => {
    const cuerpos = simularAlta();
    renderizar("/productores/nuevo");
    const usuario = userEvent.setup();

    // Primero eligió una ruta como "De ruta" y luego cambió de idea: la ruta no debe viajar
    await usuario.selectOptions(await screen.findByLabelText("Ruta"), "Ruta 4 - Collana");
    await usuario.click(screen.getByLabelText("Externo (llega a planta)"));
    expect(screen.queryByLabelText("Ruta")).not.toBeInTheDocument();
    await usuario.type(screen.getByLabelText("Nombre"), "Lácteos del Lago");
    await usuario.click(screen.getByRole("button", { name: "Crear productor" }));
    expect(screen.getByLabelText("Documento (DNI o RUC)"))
      .toHaveAccessibleDescription("El documento debe ser un DNI (8 dígitos) o RUC (11 dígitos)");
    expect(screen.getByLabelText("Celular")).toHaveAccessibleDescription("El celular debe tener 9 dígitos");
    expect(cuerpos).toEqual([]);

    await usuario.type(screen.getByLabelText("Documento (DNI o RUC)"), "20123456789");
    await usuario.type(screen.getByLabelText("Celular"), "987654321");
    await usuario.type(screen.getByLabelText("Latitud de referencia"), "-15.5");
    await usuario.type(screen.getByLabelText("Longitud de referencia"), "-69.75");
    await usuario.click(screen.getByRole("button", { name: "Crear productor" }));

    await waitFor(() => expect(ubicacion()).toBe("/productores/150"));
    expect(cuerpos).toEqual([{ nombre: "Lácteos del Lago", documento: "20123456789", celular: "987654321", tipo: "externo",
                               ruta_id: null, latitud_ref: -15.5, longitud_ref: -69.75 }]);
  });

  it("de ruta sin ruta, o con documento o celular mal escritos, no envía", async () => {
    const cuerpos = simularAlta();
    renderizar("/productores/nuevo");
    const usuario = userEvent.setup();

    await usuario.type(await screen.findByLabelText("Nombre"), "Ana");
    await usuario.type(screen.getByLabelText("Documento (DNI o RUC)"), "1234567890");
    await usuario.type(screen.getByLabelText("Celular"), "12345");
    await usuario.click(screen.getByRole("button", { name: "Crear productor" }));

    expect(screen.getByLabelText("Ruta")).toHaveAccessibleDescription("Elija la ruta");
    expect(screen.getByLabelText("Documento (DNI o RUC)")).toHaveAccessibleDescription(/^El documento debe ser/);
    expect(screen.getByLabelText("Celular")).toHaveAccessibleDescription(/^El celular debe tener 9 dígitos/);
    expect(cuerpos).toEqual([]);
  });

  it.each([
    ["-15.5", "", "longitud_ref", "Escriba también la longitud"],
    ["", "-69.75", "latitud_ref", "Escriba también la latitud"],
    ["-90.000001", "-69.75", "latitud_ref", "Latitud entre -90 y 90, con hasta 6 decimales"],
    ["91", "-69.75", "latitud_ref", "Latitud entre -90 y 90, con hasta 6 decimales"],
    ["-15.5", "180.5", "longitud_ref", "Longitud entre -180 y 180, con hasta 6 decimales"],
    ["-15.5", "-181", "longitud_ref", "Longitud entre -180 y 180, con hasta 6 decimales"],
    ["-15.1234567", "-69.75", "latitud_ref", "Latitud entre -90 y 90, con hasta 6 decimales"],
    ["abc", "-69.75", "latitud_ref", "Latitud entre -90 y 90, con hasta 6 decimales"],
  ])("ubicación lat=%j lon=%j: error en %s y no envía", async (lat, lon, campo, mensaje) => {
    const cuerpos = simularAlta();
    renderizar("/productores/nuevo");
    const usuario = userEvent.setup();

    await usuario.type(await screen.findByLabelText("Nombre"), "Ana");
    await usuario.selectOptions(screen.getByLabelText("Ruta"), "Ruta 4 - Collana");
    if (lat) await usuario.type(screen.getByLabelText("Latitud de referencia"), lat);
    if (lon) await usuario.type(screen.getByLabelText("Longitud de referencia"), lon);
    await usuario.click(screen.getByRole("button", { name: "Crear productor" }));

    const etiqueta = campo === "latitud_ref" ? "Latitud de referencia" : "Longitud de referencia";
    expect(screen.getByLabelText(etiqueta)).toHaveAccessibleDescription(new RegExp(`^${mensaje}`));
    expect(cuerpos).toEqual([]);
  });

  it("acepta los extremos del rango (-90 / 180)", async () => {
    const cuerpos = simularAlta();
    renderizar("/productores/nuevo");
    const usuario = userEvent.setup();

    await usuario.type(await screen.findByLabelText("Nombre"), "Ana");
    await usuario.selectOptions(screen.getByLabelText("Ruta"), "Ruta 4 - Collana");
    await usuario.type(screen.getByLabelText("Latitud de referencia"), "-90");
    await usuario.type(screen.getByLabelText("Longitud de referencia"), "180.000000");
    await usuario.click(screen.getByRole("button", { name: "Crear productor" }));

    await waitFor(() => expect(cuerpos).toHaveLength(1));
    expect(cuerpos[0]).toMatchObject({ latitud_ref: -90, longitud_ref: 180 });
  });

  it("409 de documento repetido: aviso arriba y no navega", async () => {
    servidor.use(http.post(`${API}/productores`, () =>
      HttpResponse.json({ codigo: "conflicto", mensaje: "Ya existe un productor con ese documento" }, { status: 409 })));
    renderizar("/productores/nuevo");
    const usuario = userEvent.setup();

    await usuario.type(await screen.findByLabelText("Nombre"), "Ana");
    await usuario.type(screen.getByLabelText("Documento (DNI o RUC)"), "42345678");
    await usuario.selectOptions(screen.getByLabelText("Ruta"), "Ruta 4 - Collana");
    await usuario.click(screen.getByRole("button", { name: "Crear productor" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ya existe un productor con ese documento");
    expect(ubicacion()).toBe("/productores/nuevo");
  });

  it("sin rutas no se puede crear: muestra el error y deja reintentar", async () => {
    const envio = vi.fn();
    servidor.use(
      http.get(`${API}/rutas`, () => HttpResponse.json({ codigo: "error_interno", mensaje: "Error interno del servidor" },
                                                       { status: 500 })),
      http.post(`${API}/productores`, () => {
        envio();
        return HttpResponse.json(productor(), { status: 201 });
      }),
    );
    renderizar("/productores/nuevo");
    expect(await screen.findByRole("alert")).toHaveTextContent("Error interno del servidor");
    expect(screen.queryByRole("button", { name: "Crear productor" })).not.toBeInTheDocument();
    expect(envio).not.toHaveBeenCalled();
  });
});
