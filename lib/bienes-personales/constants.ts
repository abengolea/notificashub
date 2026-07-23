import type { BienTipo } from "@/lib/accounting/schemas";

export const BIENES_TIPOS: readonly BienTipo[] = [
  "inmueble",
  "rodado",
  "cuenta_bancaria",
  "inversion",
  "participacion_societaria",
  "cripto",
  "otro",
] as const;

export const BIEN_TIPO_LABELS: Record<BienTipo, string> = {
  inmueble: "Inmueble",
  rodado: "Rodado",
  cuenta_bancaria: "Cuenta bancaria / plazo fijo",
  inversion: "Inversión / título",
  participacion_societaria: "Participación societaria",
  cripto: "Criptomoneda",
  otro: "Otro bien",
};

/** Un tramo de la escala progresiva: hasta `hasta` (Infinity en el último), cuota fija + alícuota marginal sobre el excedente de `desde`. */
export type BpTramo = {
  desde: number;
  hasta: number;
  cuotaFija: number;
  alicuotaMarginal: number;
};

export type BpParametrosAnio = {
  minimoNoImponible: number;
  /** Escala progresiva sobre el excedente del mínimo no imponible (bienes en el país). */
  escala: BpTramo[];
};

/**
 * Parámetros orientativos de Bienes Personales por año fiscal: mínimo no imponible y escala
 * progresiva (cuota fija + alícuota marginal por tramo de patrimonio neto excedente), análoga
 * a la estructura real de la ley (varios tramos, no una alícuota plana única).
 * Son valores de referencia: hay que verificarlos contra los montos oficiales vigentes
 * publicados por ARCA antes de declarar — cambian todos los años.
 */
export const BP_PARAMETROS_POR_ANIO: Record<number, BpParametrosAnio> = {
  2024: {
    minimoNoImponible: 100_000_000,
    escala: [
      { desde: 0, hasta: 300_000_000, cuotaFija: 0, alicuotaMarginal: 0.005 },
      { desde: 300_000_000, hasta: 1_000_000_000, cuotaFija: 1_500_000, alicuotaMarginal: 0.0075 },
      { desde: 1_000_000_000, hasta: Infinity, cuotaFija: 6_750_000, alicuotaMarginal: 0.01 },
    ],
  },
  2025: {
    minimoNoImponible: 100_000_000,
    escala: [
      { desde: 0, hasta: 300_000_000, cuotaFija: 0, alicuotaMarginal: 0.005 },
      { desde: 300_000_000, hasta: 1_000_000_000, cuotaFija: 1_500_000, alicuotaMarginal: 0.0075 },
      { desde: 1_000_000_000, hasta: Infinity, cuotaFija: 6_750_000, alicuotaMarginal: 0.01 },
    ],
  },
  // TODO: actualizar cada año con el mínimo no imponible y la escala vigentes según ARCA.
  2026: {
    minimoNoImponible: 100_000_000,
    escala: [
      { desde: 0, hasta: 300_000_000, cuotaFija: 0, alicuotaMarginal: 0.005 },
      { desde: 300_000_000, hasta: 1_000_000_000, cuotaFija: 1_500_000, alicuotaMarginal: 0.0075 },
      { desde: 1_000_000_000, hasta: Infinity, cuotaFija: 6_750_000, alicuotaMarginal: 0.01 },
    ],
  },
};

export const BP_PARAMETROS_DEFAULT: BpParametrosAnio = { minimoNoImponible: 0, escala: [] };

export function bpParametrosForYear(year: number): BpParametrosAnio {
  return BP_PARAMETROS_POR_ANIO[year] ?? BP_PARAMETROS_DEFAULT;
}

/** Calcula el impuesto aplicando la escala progresiva sobre el excedente del mínimo no imponible. */
export function bpImpuestoProgresivo(patrimonioNeto: number, parametros: BpParametrosAnio): number {
  const excedente = patrimonioNeto - parametros.minimoNoImponible;
  if (excedente <= 0) return 0;
  const tramo = parametros.escala.find((t) => excedente > t.desde && excedente <= t.hasta);
  if (!tramo) return 0;
  return tramo.cuotaFija + (excedente - tramo.desde) * tramo.alicuotaMarginal;
}
