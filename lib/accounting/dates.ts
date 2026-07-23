/**
 * Normaliza fecha YYYY-MM-DD a mediodía UTC para evitar bordes de zona horaria.
 */
export function dateOnlyToUtcMidday(dateStr: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!m) throw new Error("fecha inválida (usá YYYY-MM-DD)");
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) throw new Error("fecha fuera de rango");
  return new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
}

export function monthBoundsUtc(year: number, month: number): { start: Date; end: Date } {
  if (month < 1 || month > 12) throw new Error("mes inválido");
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { start, end };
}

export function yearBoundsUtc(year: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
  return { start, end };
}
