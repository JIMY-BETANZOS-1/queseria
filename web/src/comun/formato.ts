// Formatos de pantalla. Las horas van siempre en hora de Lima (zona de negocio), sin importar la del PC.
const HORA_LIMA = new Intl.DateTimeFormat("es-PE", {
  timeZone: "America/Lima",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const FECHA_LIMA = new Intl.DateTimeFormat("es-PE", {
  timeZone: "America/Lima",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** "HH:MM" en hora de Lima. Acepta milisegundos, Date o un texto ISO 8601 con zona (como los de la API). */
export function horaLima(instante: number | Date | string): string {
  return HORA_LIMA.format(new Date(instante));
}

/** "DD/MM/AAAA HH:MM" en hora de Lima, para instantes (timestamptz) de la API. */
export function fechaHoraLima(instante: number | Date | string): string {
  const d = new Date(instante);
  return `${FECHA_LIMA.format(d)} ${HORA_LIMA.format(d)}`;
}

/**
 * "DD/MM/AAAA" para una fecha sin hora de la API ("AAAA-MM-DD", tipo date). No pasa por Date: así no se
 * corre un día por la zona horaria.
 */
export function fecha(aaaaMmDd: string): string {
  const [a, m, d] = aaaaMmDd.split("-");
  return a && m && d ? `${d}/${m}/${a}` : aaaaMmDd;
}

const DIA_LIMA = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Lima",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Fecha de hoy en Lima como "AAAA-MM-DD" (formato de los campos date de la API y de <input type="date">). */
export function hoyLima(ahora: number | Date = Date.now()): string {
  const partes = Object.fromEntries(DIA_LIMA.formatToParts(ahora).map((p) => [p.type, p.value]));
  return `${partes.year}-${partes.month}-${partes.day}`;
}

/** Suma días a una fecha "AAAA-MM-DD" sin pasar por la zona horaria del PC. */
export function sumarDias(aaaaMmDd: string, dias: number): string {
  const [a, m, d] = aaaaMmDd.split("-").map(Number);
  return new Date(Date.UTC(a!, m! - 1, d! + dias)).toISOString().slice(0, 10);
}

/** Semana anterior a la de `hoy`, de lunes a domingo ("AAAA-MM-DD"). */
export function semanaAnterior(hoy: string): { desde: string; hasta: string } {
  const [a, m, d] = hoy.split("-").map(Number);
  const diaSemana = new Date(Date.UTC(a!, m! - 1, d!)).getUTCDay();   // 0 = domingo
  const lunes = sumarDias(hoy, -((diaSemana + 6) % 7));
  return { desde: sumarDias(lunes, -7), hasta: sumarDias(lunes, -1) };
}

/** Primer día del mes de una fecha ("AAAA-MM-DD" o "AAAA-MM") → "AAAA-MM-01". */
export function primerDiaDelMes(fecha: string): string {
  return `${fecha.slice(0, 7)}-01`;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre",
               "noviembre", "diciembre"];

/** "octubre de 2026" para "2026-10-01". */
export function nombreMes(aaaaMm: string): string {
  return `${MESES[Number(aaaaMm.slice(5, 7)) - 1] ?? aaaaMm} de ${aaaaMm.slice(0, 4)}`;
}

const LITROS = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 2 });

/** "1,234.5 L": litros con hasta 2 decimales (como numeric(8,2) de la base). */
export function litros(cantidad: number): string {
  return `${LITROS.format(cantidad)} L`;
}

const SOLES = new Intl.NumberFormat("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "S/ 1,234.50": moneda con 2 decimales. Negativo: "−S/ 1,234.50" (signo menos tipográfico antes del símbolo). */
export function soles(monto: number, decimales = 2): string {
  const f = decimales === 2
    ? SOLES
    : new Intl.NumberFormat("es-PE", { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
  // Lo que se redondea a cero no lleva signo (−0.004 → "S/ 0.00")
  const negativo = Math.round(Math.abs(monto) * 10 ** decimales) > 0 && monto < 0;
  return `${negativo ? "−" : ""}S/ ${f.format(Math.abs(monto))}`;
}

/** Precio por litro (numeric(7,3)): "S/ 1.70" con dos decimales, y tres solo si el tercero no es cero ("S/ 0.705"). */
export function precioLitro(precio: number): string {
  return soles(precio, Math.round(Math.abs(precio) * 1000) % 10 === 0 ? 2 : 3);
}

/** "1 pago pendiente" / "3 pagos pendientes": el número con su palabra en singular o plural. */
export function plural(n: number, singular: string, enPlural: string): string {
  return `${n} ${n === 1 ? singular : enPlural}`;
}
