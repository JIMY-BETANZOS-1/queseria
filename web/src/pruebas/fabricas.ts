// Datos ficticios con la forma exacta de la API (tipos de esquema.d.ts): si el backend cambia un campo, tsc avisa.
import type {
  Acopiador, AcopiadorMes, Alerta, Analista, Asignacion, CodigoActivacion, Dispositivo, Liquidacion, LiquidacionDetalle,
  PagableDelPeriodo, PagoPendienteProductor, Productor, ProductorResumen, RecoleccionDetalle, Ruta,
} from "../api/tipos";

export function acopiador(cambios: Partial<Acopiador> = {}): Acopiador {
  return {
    id: 7,
    rol: "acopiador",
    nombre_completo: "Juan Carlos Mamani Quispe",
    dni: "41234567",
    celular: "951234567",
    activo: true,
    pin_bloqueado: false,
    pin_pendiente: false,
    celular_vinculado: true,
    color_hex: "#2563EB",
    vehiculo: "motocarga",
    sueldo_base_mensual: 900,
    comision_por_litro: 0.05,
    rutas: [{ ruta_id: 1, nombre: "Ruta 1 - Huata Centro", vigente_desde: "2026-09-18" }],
    ...cambios,
  };
}

export function analista(cambios: Partial<Analista> = {}): Analista {
  return {
    id: 12,
    rol: "analista",
    nombre_completo: "María Elena Ccama Apaza",
    dni: "43456789",
    celular: "961234567",
    activo: true,
    pin_bloqueado: false,
    pin_pendiente: false,
    celular_vinculado: true,
    ...cambios,
  };
}

export function ruta(cambios: Partial<Ruta> = {}): Ruta {
  return {
    id: 21,
    nombre: "Ruta 4 - Collana",
    descripcion: "Collana y Yanamayo",
    activa: true,
    actualizado_en: "2026-10-01T09:00:00-05:00",
    acopiador_id: 7,
    acopiador: "Juan Carlos Mamani Quispe",
    color_hex: "#2563EB",
    ...cambios,
  };
}

export function asignacion(cambios: Partial<Asignacion> = {}): Asignacion {
  return {
    id: 301,
    ruta_id: 21,
    acopiador_id: 7,
    acopiador: "Juan Carlos Mamani Quispe",
    vigente_desde: "2026-09-18",
    vigente_hasta: null,
    ...cambios,
  };
}

export function productor(cambios: Partial<Productor> = {}): Productor {
  return {
    id: 120,
    codigo: "P-0120",
    nombre: "Rosa Condori Huanca",
    documento: "42345678",
    celular: "951111222",
    tipo: "de_ruta",
    ruta_id: 21,
    latitud_ref: -15.612345,
    longitud_ref: -69.912345,
    aprobado: true,
    creado_por: 1,
    uuid_cliente: null,
    activo: true,
    actualizado_en: "2026-10-01T09:00:00-05:00",
    ...cambios,
  };
}

export function productorResumen(cambios: Partial<ProductorResumen> = {}): ProductorResumen {
  return {
    productor_id: 120,
    codigo: "P-0120",
    nombre: "Rosa Condori Huanca",
    tipo: "de_ruta",
    ruta_id: 21,
    pendiente_aprobacion: false,
    acopiador: "Juan Carlos Mamani Quispe",
    color_hex: "#2563EB",
    litros_total: 1234.5,
    litros_descartados: 20,
    n_recolecciones: 40,
    ultima_recoleccion: "2026-10-18T06:15:00-05:00",
    sancionado: false,
    bloqueado: false,
    sancion_hasta: null,
    activo: true,
    ...cambios,
  };
}

export function recoleccion(cambios: Partial<RecoleccionDetalle> = {}): RecoleccionDetalle {
  return {
    recoleccion_id: "0f6c2a4e-0000-4000-8000-000000000001",
    registrada_en: "2026-10-18T06:15:00-05:00",
    fecha: "2026-10-18",
    productor_id: 120,
    productor_codigo: "P-0120",
    productor: "Rosa Condori Huanca",
    tipo_productor: "de_ruta",
    productor_pendiente: false,
    ruta_id: 21,
    ruta: "Ruta 4 - Collana",
    registrado_por: 7,
    registrado_por_nombre: "Juan Carlos Mamani Quispe",
    color_hex: "#2563EB",
    litros: 32.5,
    observacion: null,
    estado_calidad: "normal",
    revisada: true,
    latitud: -15.6123,
    longitud: -69.9123,
    precision_m: 8,
    origen_ubicacion: "gps",
    ubicacion_simulada: false,
    latitud_ref: -15.6123,
    longitud_ref: -69.9123,
    distancia_ref_m: 0,
    alertas_pendientes: 0,
    monto: 55.25,
    retenida: false,
    pagable: true,
    liquidada: false,
    anulada_en: null,
    ...cambios,
  };
}

export function alerta(cambios: Partial<Alerta> = {}): Alerta {
  return {
    id: 501,
    recoleccion_id: "0f6c2a4e-0000-4000-8000-000000000001",
    tipo: "sin_ubicacion",
    detalle: "No hubo señal GPS al registrar",
    creada_en: "2026-10-18T06:16:00-05:00",
    revisada_por: null,
    revisada_en: null,
    resolucion: null,
    fecha: "2026-10-18",
    registrada_en: "2026-10-18T06:15:00-05:00",
    productor_id: 120,
    productor_codigo: "P-0120",
    productor: "Rosa Condori Huanca",
    registrado_por: 7,
    registrado_por_nombre: "Juan Carlos Mamani Quispe",
    color_hex: "#2563EB",
    litros: 32.5,
    recoleccion_retenida: false,
    ...cambios,
  };
}

export function pagoPendiente(cambios: Partial<PagoPendienteProductor> = {}): PagoPendienteProductor {
  return { productor_id: 120, codigo: "P-0120", nombre: "Rosa Condori Huanca", litros_pagables: 100, monto_pagable: 170,
           monto_en_espera: 34, desde: "2026-10-05", hasta: "2026-10-11", ...cambios };
}

export function pagable(cambios: Partial<PagableDelPeriodo> = {}): PagableDelPeriodo {
  return { productor_id: 120, codigo: "P-0120", nombre: "Rosa Condori Huanca", n_recolecciones: 2, litros: 52.5,
           monto: 89.25, litros_con_sancion: 0, ...cambios };
}

export function liquidacion(cambios: Partial<Liquidacion> = {}): Liquidacion {
  return { liquidacion_id: 900, productor_id: 120, productor_codigo: "P-0120", productor: "Rosa Condori Huanca",
           desde: "2026-10-05", hasta: "2026-10-11", estado: "pendiente", pagada_en: null, n_recolecciones: 2,
           litros: 52.5, monto: 79.25, litros_con_sancion: 10, descuento_sancion: 10, ...cambios };
}

export function liquidacionDetalle(cambios: Partial<LiquidacionDetalle> = {}): LiquidacionDetalle {
  return {
    ...liquidacion(),
    lineas: [
      { recoleccion_id: "0f6c2a4e-0000-4000-8000-000000000101", registrada_en: "2026-10-06T06:15:00-05:00",
        fecha: "2026-10-06", litros: 42.5, precio_litro: 1.7, con_sancion: false, monto: 72.25 },
      { recoleccion_id: "0f6c2a4e-0000-4000-8000-000000000102", registrada_en: "2026-10-09T06:20:00-05:00",
        fecha: "2026-10-09", litros: 10, precio_litro: 0.7, con_sancion: true, monto: 7 },
    ],
    ...cambios,
  };
}

export function acopiadorMes(cambios: Partial<AcopiadorMes> = {}): AcopiadorMes {
  return { acopiador_id: 7, nombre_completo: "Juan Carlos Mamani Quispe", activo: true, mes: "2026-10-01", litros: 1200,
           litros_normales: 1150, recolecciones: 60, sueldo_base_mensual: 900, comision_estimada: 57.5,
           sueldo_estimado: 957.5, pago_id: null, estado: null, pago_litros_mes: null, pago_sueldo_base: null,
           pago_comision: null, ajustes: null, total: null, pagado_en: null, gasto_id: null, nota: null, ...cambios };
}

export function dispositivo(cambios: Partial<Dispositivo> = {}): Dispositivo {
  return {
    id: 31,
    usuario_id: 7,
    device_uuid: "3f2a9c1e-0000-4000-8000-000000000001",
    modelo: "realme RMX3710",
    activado_en: "2026-10-10T12:00:00-05:00",
    ultimo_acceso: "2026-10-18T06:15:00-05:00",
    activo: true,
    ...cambios,
  };
}

/** Código ficticio (mismo alfabeto y largo que los reales). */
export const CODIGO = "K7QM2XWP";

export function codigoActivacion(): CodigoActivacion {
  return { codigo: CODIGO, expira_en: "2026-10-18T16:05:00Z" };   // 11:05 en Lima
}
