// Tipos de alerta: los del ENUM tipo_alerta de db/schema.sql. Solo productor_bloqueado y firma_invalida
// retienen el pago hasta revisarlas (v_recoleccion_pago).
export const TIPOS_ALERTA: { valor: string; texto: string }[] = [
  { valor: "sin_ubicacion", texto: "Sin ubicación" },
  { valor: "ubicacion_simulada", texto: "Ubicación simulada" },
  { valor: "ubicacion_imprecisa", texto: "Ubicación imprecisa" },
  { valor: "lejos_del_productor", texto: "Lejos del productor" },
  { valor: "hora_inconsistente", texto: "Hora inconsistente" },
  { valor: "velocidad_imposible", texto: "Velocidad imposible" },
  { valor: "firma_invalida", texto: "Firma inválida" },
  { valor: "productor_bloqueado", texto: "Productor bloqueado" },
  { valor: "litros_atipicos", texto: "Litros atípicos" },
  { valor: "posible_duplicado", texto: "Posible duplicado" },
];

const RETIENEN = new Set(["productor_bloqueado", "firma_invalida"]);

/** Nombre en español; un tipo desconocido se muestra tal cual. */
export function textoTipoAlerta(tipo: string): string {
  return TIPOS_ALERTA.find((t) => t.valor === tipo)?.texto ?? tipo;
}

export function retienePago(tipo: string): boolean {
  return RETIENEN.has(tipo);
}
