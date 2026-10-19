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

const LITROS = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 2 });

/** "1,234.5 L": litros con hasta 2 decimales (como numeric(8,2) de la base). */
export function litros(cantidad: number): string {
  return `${LITROS.format(cantidad)} L`;
}

const SOLES = new Intl.NumberFormat("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "S/ 1,234.50": moneda con 2 decimales. */
export function soles(monto: number, decimales = 2): string {
  const f = decimales === 2
    ? SOLES
    : new Intl.NumberFormat("es-PE", { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
  return `S/ ${f.format(monto)}`;
}
