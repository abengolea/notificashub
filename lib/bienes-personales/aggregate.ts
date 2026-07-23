import { round2 } from "@/lib/sifere-cm05/codes";
import { bpImpuestoProgresivo, bpParametrosForYear } from "@/lib/bienes-personales/constants";
import type { BienNaturaleza, BienTipo } from "@/lib/accounting/schemas";

export type BienInput = {
  naturaleza: BienNaturaleza;
  tipo: BienTipo;
  valuacionFiscal: number;
};

export type BienesPersonalesYearSummary = {
  year: number;
  totalActivos: number;
  totalPasivos: number;
  patrimonioNeto: number;
  activosPorTipo: Partial<Record<BienTipo, number>>;
  minimoNoImponible: number;
  /** Orientativo: verificar con contador contra los valores oficiales vigentes. */
  impuestoEstimado: number;
};

export function computeBienesPersonalesYear(bienes: BienInput[], year: number): BienesPersonalesYearSummary {
  let totalActivos = 0;
  let totalPasivos = 0;
  const activosPorTipo: Partial<Record<BienTipo, number>> = {};

  for (const b of bienes) {
    const monto = round2(b.valuacionFiscal || 0);
    if (b.naturaleza === "activo") {
      totalActivos = round2(totalActivos + monto);
      activosPorTipo[b.tipo] = round2((activosPorTipo[b.tipo] ?? 0) + monto);
    } else {
      totalPasivos = round2(totalPasivos + monto);
    }
  }

  const patrimonioNeto = round2(totalActivos - totalPasivos);
  const parametros = bpParametrosForYear(year);
  const impuestoEstimado = round2(bpImpuestoProgresivo(patrimonioNeto, parametros));

  return {
    year,
    totalActivos,
    totalPasivos,
    patrimonioNeto,
    activosPorTipo,
    minimoNoImponible: parametros.minimoNoImponible,
    impuestoEstimado,
  };
}
