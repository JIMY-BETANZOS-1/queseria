// Cuándo actúa cada parámetro, según dónde lo lee la base (db/schema.sql): dias_sancion y dias_gracia en
// fn_aplicar_sancion (al revisar); pagar_leche_alterada en v_recoleccion_pago, comision_incluye_descartada en
// v_acopiador_mes, dias_max_leche en v_leche_jornada, dias_alerta_vencimiento en v_lote_disponible y color_externo
// en las vistas de productores (todas en vivo); los max_* y factor_* en fn_alertas_recoleccion (al registrar).
// empresa_nombre no lo lee nadie todavía. La pantalla lo muestra junto a la descripción y la confirmación lo repite.
const EFECTOS: Record<string, string> = {
  dias_sancion: "Se aplica a las sanciones que se creen desde ahora; no cambia las vigentes.",
  dias_gracia_reincidencia: "Se aplica a las sanciones que se creen desde ahora; no cambia las vigentes.",
  pagar_leche_alterada: "Cambia al instante el monto de la leche alterada que aún no está liquidada.",
  comision_incluye_descartada:
    "Cambia al instante la comisión estimada de los acopiadores; los pagos ya registrados guardan la suya.",
  dias_max_leche: "Cambia al instante qué jornadas aparecen \"sin destino\".",
  dias_alerta_vencimiento: "Cambia al instante qué lotes aparecen \"por vencer\".",
  color_externo: "Cambia al instante el color de los productores externos en las listas.",
  empresa_nombre: "Todavía no se usa: está reservado para reportes y comprobantes.",
  max_distancia_productor_m: "Se aplica a las recolecciones que lleguen desde ahora; no cambia las alertas ya creadas.",
  max_precision_gps_m: "Se aplica a las recolecciones que lleguen desde ahora; no cambia las alertas ya creadas.",
  max_desfase_hora_min: "Se aplica a las recolecciones que lleguen desde ahora; no cambia las alertas ya creadas.",
  max_velocidad_kmh: "Se aplica a las recolecciones que lleguen desde ahora; no cambia las alertas ya creadas.",
  factor_litros_atipicos: "Se aplica a las recolecciones que lleguen desde ahora; no cambia las alertas ya creadas.",
};

export function efectoDe(clave: string): string | null {
  return EFECTOS[clave] ?? null;
}

/** Tipo de control según el formato del valor actual (el mismo criterio que el servidor). */
export function tipoDeValor(valor: string): "booleano" | "color" | "numero" | "texto" {
  if (/^(true|false)$/.test(valor)) return "booleano";
  if (/^#[0-9A-Fa-f]{6}$/.test(valor)) return "color";
  if (/^-?\d+(\.\d+)?$/.test(valor)) return "numero";
  return "texto";
}
