// Datas locais da operação (Angola, UTC+1, sem horário de verão).
// Um "dia local" é representado como string "YYYY-MM-DD"; instantes são milissegundos UTC.

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

export type LocalDate = string;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function parseInstant(value: string | number | Date): number {
  const ms = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`Data inválida: ${String(value)}`);
  return ms;
}

/** Dia local (YYYY-MM-DD) em que cai um instante. */
export function localDateOf(instant: number, utcOffsetMinutes: number): LocalDate {
  const shifted = new Date(instant + utcOffsetMinutes * 60_000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** Instante UTC correspondente a uma hora local ("HH:MM", aceita "24:00") de um dia local. */
export function localTimeToInstant(date: LocalDate, time: string, utcOffsetMinutes: number): number {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return Date.UTC(year, month - 1, day, hour, minute) - utcOffsetMinutes * 60_000;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** Dia da semana ISO: 1 = segunda … 7 = domingo. */
export function isoWeekday(date: LocalDate): number {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** Segunda-feira (dia local) da semana que contém o dia indicado. */
export function weekStartOf(date: LocalDate): LocalDate {
  return addDays(date, 1 - isoWeekday(date));
}

export function weekDays(weekStart: LocalDate): LocalDate[] {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

export function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}
