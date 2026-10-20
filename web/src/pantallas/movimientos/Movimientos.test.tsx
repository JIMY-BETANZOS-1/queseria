import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Movimiento } from "../../api/tipos";
import { respuestaLogin } from "../../pruebas/datos";
import { irPorMenu } from "../../pruebas/menu";
import { renderizar, ubicacion } from "../../pruebas/renderizar";
import { API, servidor } from "../../pruebas/servidor";
import { guardarSesion } from "../../sesion/almacen";

beforeEach(() => {
  guardarSesion(respuestaLogin());
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 19, 4, 30));   // 23:30 del 18/10 en Lima
});

afterEach(() => {
  vi.useRealTimers();
});

function fila(tipo: Movimiento["tipo"], cambios: Partial<Movimiento>): Movimiento {
  return { tipo, fecha: "2026-10-05", registrado_en: null, descripcion: "", referencia: null, liquidacion_id: null,
           ingreso: null, egreso: null, perdida: null, ...cambios };
}

const MOVIMIENTOS: Movimiento[] = [
  fila("compra_insumo", { fecha: "2026-10-02", descripcion: "Compra: Sal 10 kg × S/ 1.5000", egreso: 15 }),
  fila("venta", { descripcion: "Venta a Bodega Lucía: 2 de Queso paria × S/ 19.50", referencia: "L-2026-0003", ingreso: 39 }),
  fila("pago_productor", { fecha: "2026-10-06", descripcion: "Liquidación n.º 12: Pedro Quispe (del 28/09/2026 al 04/10/2026)",
                           referencia: "P-0007", liquidacion_id: 12, egreso: 51.85 }),
  fila("gasto", { fecha: "2026-10-07", descripcion: "Sueldo acopiador: Sueldo de Juan Mamani (09/2026) · Juan Mamani", egreso: 300 }),
  fila("merma", { fecha: "2026-10-08", descripcion: "Merma de leche: 5 L · Se derramó", perdida: 9.11 }),
  fila("baja", { fecha: "2026-10-09", descripcion: "Baja (vencido): 1 de Queso paria", referencia: "L-2026-0003", perdida: 6.4 }),
];

function simular(filas: Movimiento[] = MOVIMIENTOS) {
  const consultas: string[] = [];
  servidor.use(http.get(`${API}/movimientos`, ({ request }) => {
    consultas.push(new URL(request.url).search);
    return HttpResponse.json(filas);
  }));
  return consultas;
}

const celdas = (f: HTMLElement) => within(f).getAllByRole("cell").map((c) => c.textContent);

describe("movimientos", () => {
  it("el mes actual en Lima: filas en su columna, totales, las tres notas y el enlace a la liquidación", async () => {
    const consultas = simular();
    renderizar("/movimientos");
    const tabla = await screen.findByRole("table", { name: "Movimientos de octubre de 2026" });
    expect(consultas).toEqual(["?mes=2026-10-01"]);

    const filas = within(tabla).getAllByRole("row").slice(1);
    expect(celdas(filas[0]!)).toEqual(["02/10/2026", "Compra de insumo", "Compra: Sal 10 kg × S/ 1.5000", "", "", "S/ 15.00", ""]);
    expect(celdas(filas[1]!)).toEqual(["05/10/2026", "Venta", "Venta a Bodega Lucía: 2 de Queso paria × S/ 19.50", "L-2026-0003",
                                       "S/ 39.00", "", ""]);
    expect(celdas(filas[2]!)).toEqual(["06/10/2026", "Pago a productor",
      "Liquidación n.º 12: Pedro Quispe (del 28/09/2026 al 04/10/2026)", "Liquidación n.º 12", "", "S/ 51.85", ""]);
    expect(celdas(filas[3]!)[1]).toBe("Gasto");
    expect(celdas(filas[4]!)).toEqual(["08/10/2026", "Merma de leche", "Merma de leche: 5 L · Se derramó", "", "", "", "S/ 9.11"]);
    expect(celdas(filas[5]!).slice(1)).toEqual(["Baja de producto", "Baja (vencido): 1 de Queso paria", "L-2026-0003", "", "", "S/ 6.40"]);
    expect(celdas(filas[6]!)).toEqual(["Total (6 movimientos)", "S/ 39.00", "S/ 366.85", "S/ 15.51"]);

    expect(screen.getByText(/se muestran en la fecha en que se pagó la liquidación \(pago real\)/)).toHaveTextContent(
      "El flujo del Resumen cuenta la leche en la fecha de entrega, así que el total del mes puede no coincidir.");
    expect(screen.getByText(/Pérdidas \(mermas y bajas\) no mueven dinero/)).toHaveTextContent(
      "El resultado del Resumen además cuenta lo pagado en jornadas sin leche aprobada.");
    expect(screen.getByText('Los sueldos de acopiadores aparecen una vez, como gasto "Sueldo acopiador".')).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Movimientos · Quesería Huata"));

    await userEvent.setup().click(within(filas[2]!).getByRole("link", { name: "Liquidación n.º 12" }));
    expect(ubicacion()).toBe("/pagos/liquidaciones/12");
  });

  it("mes y tipo van a la URL y a la consulta; vacío con su mensaje", async () => {
    const consultas = simular([]);
    renderizar("/movimientos");
    expect(await screen.findByText("No hay movimientos en octubre de 2026.")).toBeInTheDocument();

    await userEvent.setup().selectOptions(screen.getByLabelText("Tipo"), "Merma de leche");
    expect(ubicacion()).toBe("/movimientos?mes=2026-10&tipo=merma");
    expect(await screen.findByText('No hay movimientos de tipo "Merma de leche" en octubre de 2026.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Mes"), { target: { value: "2026-09" } });
    expect(ubicacion()).toBe("/movimientos?mes=2026-09&tipo=merma");
    await waitFor(() => expect(consultas.at(-1)).toBe("?mes=2026-09-01&tipo=merma"));

    await userEvent.setup().selectOptions(screen.getByLabelText("Tipo"), "Todos");
    expect(ubicacion()).toBe("/movimientos?mes=2026-09");
    await waitFor(() => expect(consultas.at(-1)).toBe("?mes=2026-09-01"));
    expect(consultas).toEqual(["?mes=2026-10-01", "?mes=2026-10-01&tipo=merma", "?mes=2026-09-01&tipo=merma", "?mes=2026-09-01"]);
  });

  it("un tipo o un mes inválidos en la URL se ignoran", async () => {
    const consultas = simular([]);
    renderizar("/movimientos?mes=2026-13x&tipo=sueldo");
    await screen.findByText("No hay movimientos en octubre de 2026.");
    expect(consultas).toEqual(["?mes=2026-10-01"]);
    expect(screen.getByLabelText("Tipo")).toHaveValue("");
  });

  it("si la carga falla, muestra el error y Reintentar vuelve a pedir", async () => {
    let veces = 0;
    servidor.use(http.get(`${API}/movimientos`, () => {
      veces += 1;
      return veces === 1 ? HttpResponse.json({ codigo: "error_interno", mensaje: "Error interno del servidor" }, { status: 500 })
        : HttpResponse.json(MOVIMIENTOS);
    }));
    renderizar("/movimientos");
    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Error interno del servidor");
    await userEvent.setup().click(within(alerta).getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });
});

describe("menú", () => {
  it("Dinero lleva a Movimientos", async () => {
    simular([]);
    renderizar("/");
    await irPorMenu(userEvent.setup(), "Dinero", "Movimientos");
    expect(ubicacion()).toBe("/movimientos");
    expect(await screen.findByText("No hay movimientos en octubre de 2026.")).toBeInTheDocument();
  });
});
