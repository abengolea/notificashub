import { CATEGORY_TO_CM05, CM05_INGRESOS_SERVICIOS_CODE, round2, type Cm05LeafCode } from "@/lib/sifere-cm05/codes";
import type { AccountingCategory } from "@/lib/accounting/pago-fiscal";
import type { Cm05JurisdiccionCode } from "@/lib/sifere-cm05/jurisdictions";

export type Cm05AmountKey = `${Cm05LeafCode}|${Cm05JurisdiccionCode | "NO_COMPUTABLE"}`;

export type Cm05VentaInput = {
  netoGravado: number;
  tipoComprobante?: string | null;
};

export type Cm05GastoInput = {
  amount: number;
  accountingCategory: AccountingCategory | null;
};

export type Cm05AggregateResult = {
  /** Montos por código hoja × jurisdicción (o NO_COMPUTABLE). */
  amounts: Map<Cm05AmountKey, number>;
  ingresosNeto: number;
  gastosNeto: number;
  ventasCount: number;
  gastosCount: number;
  gastosOmitidosSocio: number;
};

function amountKey(code: Cm05LeafCode, jur: Cm05JurisdiccionCode | "NO_COMPUTABLE"): Cm05AmountKey {
  return `${code}|${jur}`;
}

function esNotaCredito(tipoComprobante: string | null | undefined): boolean {
  const t = (tipoComprobante ?? "").trim().toLowerCase();
  return t.startsWith("credito");
}

export function addAmount(
  map: Map<Cm05AmountKey, number>,
  code: Cm05LeafCode,
  jur: Cm05JurisdiccionCode | "NO_COMPUTABLE",
  value: number
): void {
  if (!Number.isFinite(value) || value === 0) return;
  const k = amountKey(code, jur);
  map.set(k, round2((map.get(k) ?? 0) + value));
}

/**
 * Base imponible de gasto para CM05: neto gravado + exento;
 * si no hay desglose, total menos IVA y percepciones.
 */
export function gastoBaseImponible(input: {
  totalAmount: number;
  netTaxedAmount: number;
  exemptAmount: number;
  vat21Amount: number;
  vat105Amount: number;
  vat27Amount: number;
  vatPerceptionAmount: number;
  grossIncomePerceptionAmount: number;
  otherTaxesAmount: number;
}): number {
  const netLike = round2((input.netTaxedAmount || 0) + (input.exemptAmount || 0));
  if (netLike > 0) return netLike;
  const deducted = round2(
    (input.totalAmount || 0) -
      (input.vat21Amount || 0) -
      (input.vat105Amount || 0) -
      (input.vat27Amount || 0) -
      (input.vatPerceptionAmount || 0) -
      (input.grossIncomePerceptionAmount || 0) -
      (input.otherTaxesAmount || 0)
  );
  return deducted > 0 ? deducted : round2(input.totalAmount || 0);
}

/** Agrega ventas → 1106 y gastos por categoría contable, en una jurisdicción (o no computable). */
export function aggregateCm05Period(input: {
  ventas: Cm05VentaInput[];
  gastos: Cm05GastoInput[];
  jurisdiccion: Cm05JurisdiccionCode;
}): Cm05AggregateResult {
  const amounts = new Map<Cm05AmountKey, number>();
  let ingresosNeto = 0;
  let ventasCount = 0;
  let gastosNeto = 0;
  let gastosCount = 0;
  let gastosOmitidosSocio = 0;

  for (const v of input.ventas) {
    const sign = esNotaCredito(v.tipoComprobante) ? -1 : 1;
    const neto = round2((Number(v.netoGravado) || 0) * sign);
    if (neto === 0) continue;
    addAmount(amounts, CM05_INGRESOS_SERVICIOS_CODE, input.jurisdiccion, neto);
    ingresosNeto = round2(ingresosNeto + neto);
    ventasCount += 1;
  }

  for (const g of input.gastos) {
    const amt = round2(Number(g.amount) || 0);
    if (amt === 0) continue;
    const cat = g.accountingCategory;
    if (cat === "aporte_reintegro_socio") {
      gastosOmitidosSocio += 1;
      continue;
    }
    const code: Cm05LeafCode = cat ? (CATEGORY_TO_CM05[cat] ?? "2226") : "2226";
    if (!code) {
      gastosOmitidosSocio += 1;
      continue;
    }
    addAmount(amounts, code, input.jurisdiccion, amt);
    gastosNeto = round2(gastosNeto + amt);
    gastosCount += 1;
  }

  return { amounts, ingresosNeto, gastosNeto, ventasCount, gastosCount, gastosOmitidosSocio };
}

export function getAmount(
  amounts: Map<Cm05AmountKey, number>,
  code: Cm05LeafCode,
  jur: Cm05JurisdiccionCode | "NO_COMPUTABLE"
): number {
  return amounts.get(amountKey(code, jur)) ?? 0;
}
