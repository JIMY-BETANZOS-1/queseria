// Datos ficticios con la forma exacta de la API (tipos de esquema.d.ts): si el backend cambia un campo, tsc avisa.
import type { Acopiador, Analista, Asignacion, CodigoActivacion, Dispositivo, Ruta } from "../api/tipos";

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
