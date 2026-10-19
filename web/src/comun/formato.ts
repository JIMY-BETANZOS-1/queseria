// Formatos de pantalla. Las horas van siempre en hora de Lima (zona de negocio), sin importar la del PC.
const HORA_LIMA = new Intl.DateTimeFormat("es-PE", {
  timeZone: "America/Lima",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "HH:MM" en hora de Lima. */
export function horaLima(instante: number | Date): string {
  return HORA_LIMA.format(instante);
}
