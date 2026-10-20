// API simulada para las pruebas (MSW). Cada prueba define sus respuestas con servidor.use(...).
// Una petición sin respuesta definida hace fallar la prueba: nunca se llama a la API real.
//
// Excepciones, con respuesta por defecto (handlers iniciales: los de servidor.use de cada prueba les ganan, y
// resetHandlers vuelve a ellos):
// - El Dashboard es la pantalla de inicio (/): cualquier prueba que abre "/" lo carga.
// - La configuración: el comprobante de liquidación la pide para el nombre de la empresa al imprimir.
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import type { Dashboard, Parametro } from "../api/tipos";

export const API = "http://api.prueba";   // = VITE_API_URL de las pruebas (vite.config.ts)

export const DASHBOARD_VACIO: Dashboard = {
  mes: "2026-10-01",
  leche: { litros_recolectados: 0, litros_aprobados: 0, litros_por_revisar: 0, litros_descartados: 0, costo_pagado: 0 },
  flujo: { ingresos: 0, egreso_leche: 0, egreso_insumos: 0, egreso_lotes: 0, egreso_operativo: 0, total_invertido: 0, saldo_caja: 0 },
  resultado: { ingresos: 0, costo_ventas: 0, perdida_producto: 0, perdida_leche: 0, gasto_operativo: 0, utilidad_neta: 0 },
  por_pagar: { monto_pagable: 0, monto_en_espera: 0, liquidaciones_pendientes: 0, monto_liquidaciones_pendientes: 0 },
  acopiadores: { sueldo_estimado: 0, pagado: 0, pagos_pendientes: 0 },
  atencion: { alertas_pendientes: 0, alertas_que_retienen: 0, altas_por_aprobar: 0, entregas_sin_revisar: 0, productores_observados: 0 },
};

export const PARAMETROS_POR_DEFECTO: Parametro[] = [
  { clave: "empresa_nombre", valor: "Quesería Huata", descripcion: "Nombre que aparece en reportes y comprobantes" },
];

export const servidor = setupServer(
  http.get(`${API}/dashboard`, () => HttpResponse.json(DASHBOARD_VACIO)),
  http.get(`${API}/jornadas`, () => HttpResponse.json([])),
  http.get(`${API}/configuracion`, () => HttpResponse.json(PARAMETROS_POR_DEFECTO)),
);
