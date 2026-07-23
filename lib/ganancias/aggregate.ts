import { round2 } from "@/lib/sifere-cm05/codes";
import type { AccountingCategory } from "@/lib/accounting/pago-fiscal";
import type { DeduccionCategoria } from "@/lib/accounting/schemas";
import { MONTH_LABELS_ES } from "@/lib/ganancias/constants";

export type GananciasVentaInput = { month: number; netoGravado: number };
export type GananciasGastoInput = {
  month: number;
  amount: number;
  accountingCategory: AccountingCategory | null;
};
export type GananciasDeduccionInput = { month: number; categoria: DeduccionCategoria; importe: number };

export type GananciasMonthSummary = {
  month: number;
  label: string;
  ingresoBruto: number;
  gastosPorCategoria: Partial<Record<AccountingCategory, number>>;
  totalGastosDeducibles: number;
  deduccionesPersonales: number;
  resultadoNeto: number;
};

export type GananciasYearSummary = {
  year: number;
  months: GananciasMonthSummary[];
  totalIngresoBruto: number;
  totalGastosDeducibles: number;
  totalDeduccionesPersonales: number;
  totalResultadoNeto: number;
};

/** Agrega ingresos (devengado, facturas venta) y gastos deducibles (pagos marcados) por mes calendario. */
export function computeGananciasYear(input: {
  year: number;
  ventas: GananciasVentaInput[];
  gastos: GananciasGastoInput[];
  deducciones: GananciasDeduccionInput[];
}): GananciasYearSummary {
  const months: GananciasMonthSummary[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    label: MONTH_LABELS_ES[i],
    ingresoBruto: 0,
    gastosPorCategoria: {},
    totalGastosDeducibles: 0,
    deduccionesPersonales: 0,
    resultadoNeto: 0,
  }));

  for (const v of input.ventas) {
    const m = months[v.month - 1];
    if (!m) continue;
    m.ingresoBruto = round2(m.ingresoBruto + (v.netoGravado || 0));
  }

  for (const g of input.gastos) {
    const m = months[g.month - 1];
    if (!m) continue;
    const cat = g.accountingCategory ?? "otro";
    m.gastosPorCategoria[cat] = round2((m.gastosPorCategoria[cat] ?? 0) + (g.amount || 0));
    m.totalGastosDeducibles = round2(m.totalGastosDeducibles + (g.amount || 0));
  }

  for (const d of input.deducciones) {
    const m = months[d.month - 1];
    if (!m) continue;
    m.deduccionesPersonales = round2(m.deduccionesPersonales + (d.importe || 0));
  }

  let totalIngresoBruto = 0;
  let totalGastosDeducibles = 0;
  let totalDeduccionesPersonales = 0;
  for (const m of months) {
    m.resultadoNeto = round2(m.ingresoBruto - m.totalGastosDeducibles - m.deduccionesPersonales);
    totalIngresoBruto = round2(totalIngresoBruto + m.ingresoBruto);
    totalGastosDeducibles = round2(totalGastosDeducibles + m.totalGastosDeducibles);
    totalDeduccionesPersonales = round2(totalDeduccionesPersonales + m.deduccionesPersonales);
  }

  return {
    year: input.year,
    months,
    totalIngresoBruto,
    totalGastosDeducibles,
    totalDeduccionesPersonales,
    totalResultadoNeto: round2(totalIngresoBruto - totalGastosDeducibles - totalDeduccionesPersonales),
  };
}
