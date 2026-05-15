import { BILLING_IVA_ALICUOTA } from "@/lib/billing/constants";

export type MontosFacturaGravada = {
  netoGravado: number;
  iva: number;
  total: number;
};

/** Redondeo a centavos ARS (evita flotantes raros). */
export function roundArs2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function montosDesdeUsdTipoCambio(
  usd: number,
  arsPorUsd: number,
  tipoComprobante: "A" | "B" | "C",
  alicuotaIva = BILLING_IVA_ALICUOTA,
): MontosFacturaGravada {
  const bruto = roundArs2(usd * arsPorUsd);
  if (tipoComprobante === "C") {
    return { netoGravado: bruto, iva: 0, total: bruto };
  }
  if (tipoComprobante === "B") {
    const total = bruto;
    const netoGravado = roundArs2(total / (1 + alicuotaIva));
    const iva = roundArs2(total - netoGravado);
    return { netoGravado, iva, total };
  }
  const netoGravado = bruto;
  const iva = roundArs2(netoGravado * alicuotaIva);
  const total = roundArs2(netoGravado + iva);
  return { netoGravado, iva, total };
}

export function periodoKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function billingRecurrenteKey(clientId: string, year: number, month: number): string {
  return `${clientId}|${periodoKey(year, month)}`;
}

export function buildObservacionesRecurrente(opts: {
  conceptoLinea: string;
  tipoComprobante: "A" | "B" | "C";
  usd: number;
  arsPorUsd: number;
  netoGravado: number;
  fuenteTipoCambio: string;
  billingKey: string;
}): string {
  const conv = roundArs2(opts.usd * opts.arsPorUsd);
  const bloque = [
    `[RECURRENTE key=${opts.billingKey}]`,
    `Comprobante tipo ${opts.tipoComprobante}.`,
    opts.conceptoLinea.trim(),
    `Monto contractual mensual: USD ${opts.usd.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`,
    `Tipo de cambio aplicado (referencia): ${opts.arsPorUsd.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ARS por USD 1 — ${opts.fuenteTipoCambio}.`,
    opts.tipoComprobante === "B"
      ? `Precio final en pesos (incluye IVA según Factura B): USD ${opts.usd} × $${opts.arsPorUsd} = $${conv.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`
      : `Conversión: USD ${opts.usd} × $${opts.arsPorUsd} = $${conv.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} neto gravado (${opts.tipoComprobante === "A" ? "Factura A" : "sin IVA Factura C"}).`,
  ];
  return bloque.filter(Boolean).join("\n");
}
