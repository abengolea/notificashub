/**
 * Libro de IVA Digital — fechas orientativas de registración por período tributario,
 * último dígito CUIT y fecha "Todas" (primer hito mensual consolidado según fuente pública 2026).
 *
 * Fuente de referencia: calendarios fiscales que replican publicaciones ARCA/AFIP
 * — verificación siempre contra https://www.afip.gob.ar/vencimientos/ o aplicativos ARCA.
 *
 * Clave: período tributario año-mes cerrado (`periodoYYYY-MM`), ej. 2026-03 = marzo/2026.
 */
export type GrupoCuil = "01" | "23" | "45" | "67" | "89";

export type LibroIvaMesEntry = {
  /** Fecha primera obligación “Todas” (registración común mensual cuando aplica aparte por CUIT). */
  todasISO: string;
  gruposISO: Record<GrupoCuil, string>;
};

/** Períodos de dic/2025 a nov/2026 (vencimiento en calendario 2026 cargado hasta dic/2026). */
export const LIBRO_IVA_VENCIMIENTOS: Record<string, LibroIvaMesEntry> = {
  "2025-12": {
    todasISO: "2026-01-15",
    gruposISO: { "01": "2026-01-19", "23": "2026-01-20", "45": "2026-01-21", "67": "2026-01-22", "89": "2026-01-23" },
  },
  "2026-01": {
    todasISO: "2026-02-18",
    gruposISO: { "01": "2026-02-18", "23": "2026-02-19", "45": "2026-02-20", "67": "2026-02-23", "89": "2026-02-24" },
  },
  "2026-02": {
    todasISO: "2026-03-16",
    gruposISO: { "01": "2026-03-18", "23": "2026-03-19", "45": "2026-03-20", "67": "2026-03-25", "89": "2026-03-26" },
  },
  "2026-03": {
    todasISO: "2026-04-15",
    gruposISO: { "01": "2026-04-20", "23": "2026-04-21", "45": "2026-04-22", "67": "2026-04-23", "89": "2026-04-24" },
  },
  "2026-04": {
    todasISO: "2026-05-15",
    gruposISO: { "01": "2026-05-18", "23": "2026-05-19", "45": "2026-05-20", "67": "2026-05-21", "89": "2026-05-22" },
  },
  "2026-05": {
    todasISO: "2026-06-16",
    gruposISO: { "01": "2026-06-18", "23": "2026-06-19", "45": "2026-06-22", "67": "2026-06-23", "89": "2026-06-24" },
  },
  "2026-06": {
    todasISO: "2026-07-15",
    gruposISO: { "01": "2026-07-20", "23": "2026-07-21", "45": "2026-07-22", "67": "2026-07-23", "89": "2026-07-24" },
  },
  "2026-07": {
    todasISO: "2026-08-18",
    gruposISO: { "01": "2026-08-18", "23": "2026-08-19", "45": "2026-08-20", "67": "2026-08-21", "89": "2026-08-24" },
  },
  "2026-08": {
    todasISO: "2026-09-15",
    gruposISO: { "01": "2026-09-18", "23": "2026-09-21", "45": "2026-09-22", "67": "2026-09-23", "89": "2026-09-24" },
  },
  "2026-09": {
    todasISO: "2026-10-15",
    gruposISO: { "01": "2026-10-19", "23": "2026-10-20", "45": "2026-10-21", "67": "2026-10-22", "89": "2026-10-23" },
  },
  "2026-10": {
    todasISO: "2026-11-16",
    gruposISO: { "01": "2026-11-18", "23": "2026-11-19", "45": "2026-11-20", "67": "2026-11-24", "89": "2026-11-25" },
  },
  "2026-11": {
    todasISO: "2026-12-15",
    gruposISO: { "01": "2026-12-18", "23": "2026-12-21", "45": "2026-12-22", "67": "2026-12-23", "89": "2026-12-24" },
  },
};
