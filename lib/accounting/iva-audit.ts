import {
  isPagoExportableToIvaCompras,
  isVatComputableInvoiceType,
  suggestVat21FromTotal,
  totalVatAmount,
  type PagoExportCandidate,
} from "@/lib/accounting/pago-fiscal";
import { pagoEffectiveInvoiceDate } from "@/lib/accounting/iva-compras-export";
import { pagoDocToRecord, pagoToNormalizedFact } from "@/lib/accounting/pago-persist";
import {
  inferLegacyFiscalFields,
  resolvePagoForIvaExport,
  type LegacyInferenceResult,
} from "@/lib/accounting/pago-legacy-infer";
import type { NormalizedFact } from "@/lib/arca-export/iva-lines";

export type PagoAuditStatus = "INCLUIDO" | "EXCLUIDO" | "INFERIDO_PENDIENTE_REVISION";

export type PagoAuditItem = {
  id: string;
  concepto: string;
  proveedor: string;
  totalAmount: number;
  paymentDate: string;
  invoiceDateEffective: string;
  tienePdf: boolean;
  invoiceTypeStored: string | null;
  invoiceTypeEffective: string | null;
  isVatComputableStored: boolean;
  isVatComputableEffective: boolean;
  issuedToCompanyEffective: boolean | null;
  status: PagoAuditStatus;
  motivos: string[];
  ivaPotencialPerdido: number;
  legacyInference: LegacyInferenceResult;
  usedLegacyFallback: boolean;
  exportableAfterResolve: boolean;
};

export type IvaAuditReport = {
  periodo: { year: number; month: number; key: string };
  resumen: {
    totalGastosPeriodo: number;
    gastosConPdf: number;
    gastosFacturaAStored: number;
    gastosFacturaAEffective: number;
    gastosIvaComputableStored: number;
    gastosIvaComputableEffective: number;
    gastosExportados: number;
    gastosExcluidos: number;
    gastosInferidosPendientes: number;
    ivaCreditoPotencialPerdido: number;
    ivaCreditoExportable: number;
    facturasCompraExportadas: number;
  };
  gastos: PagoAuditItem[];
  lineasTexto: string[];
};

function inPeriod(ymd: string | null, year: number, month: number): boolean {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [y, m] = ymd.split("-").map((x) => parseInt(x, 10));
  return y === year && m === month;
}

function candidateFromResolved(resolved: ReturnType<typeof resolvePagoForIvaExport>): PagoExportCandidate {
  const effDate = pagoEffectiveInvoiceDate(resolved);
  return {
    id: resolved.id,
    invoiceDate: effDate,
    paymentDate: resolved.paymentDate,
    invoiceType: resolved.invoiceType,
    posNumber: resolved.posNumber,
    invoiceNumber: resolved.invoiceNumber,
    supplierCuit: resolved.supplierCuit,
    supplierName: resolved.supplierName,
    isVatComputable: resolved.isVatComputable,
    issuedToCompany: resolved.issuedToCompany,
    totalAmount: resolved.totalAmount,
    netTaxedAmount: resolved.netTaxedAmount,
    vat21Amount: resolved.vat21Amount,
    vat105Amount: resolved.vat105Amount,
    vat27Amount: resolved.vat27Amount,
    vatPerceptionAmount: resolved.vatPerceptionAmount,
    grossIncomePerceptionAmount: resolved.grossIncomePerceptionAmount,
    otherTaxesAmount: resolved.otherTaxesAmount,
    exemptAmount: resolved.exemptAmount,
  };
}

/** Lista motivos de exclusión sobre registro crudo en Firestore. */
export function diagnoseRawExclusionMotivos(
  rec: ReturnType<typeof pagoDocToRecord>,
  year: number,
  month: number
): string[] {
  const motivos: string[] = [];
  const effDate = pagoEffectiveInvoiceDate(rec);

  if (!inPeriod(effDate, year, month)) {
    motivos.push(`Fuera del período (fecha efectiva: ${effDate || "sin fecha"})`);
    return motivos;
  }

  if (!rec.isVatComputable) {
    motivos.push("isVatComputable = false (campo no marcado en Firestore)");
  }
  if (!rec.invoiceType) {
    motivos.push("Falta invoiceType (gasto legacy sin tipo de comprobante)");
  } else if (!isVatComputableInvoiceType(rec.invoiceType)) {
    motivos.push(`invoiceType = ${rec.invoiceType} (no es Factura A)`);
  }
  if (rec.issuedToCompany !== true) {
    if (rec.issuedToCompany === false) {
      motivos.push("issuedToCompany = false (no emitida a NOTIFICAS SRL)");
    } else {
      motivos.push("issuedToCompany no verificado (null — requerido true para exportar)");
    }
  }
  if (!rec.supplierCuit?.trim()) {
    motivos.push("Falta CUIT proveedor");
  }
  if (!rec.posNumber?.trim()) {
    motivos.push("Falta punto de venta");
  }
  if (!rec.invoiceNumber?.trim()) {
    motivos.push("Falta número de comprobante");
  }
  if (!(rec.netTaxedAmount > 0)) {
    motivos.push("Falta neto gravado (netTaxedAmount = 0)");
  }
  if (!(totalVatAmount(rec) > 0)) {
    motivos.push("Falta IVA discriminado (vat21/105/27 = 0)");
  }

  return motivos;
}

export function diagnoseResolvedExclusionMotivos(
  resolved: ReturnType<typeof resolvePagoForIvaExport>,
  year: number,
  month: number
): string[] {
  const motivos: string[] = [];
  const effDate = pagoEffectiveInvoiceDate(resolved);

  if (!inPeriod(effDate, year, month)) {
    motivos.push(`Fuera del período (fecha efectiva: ${effDate || "sin fecha"})`);
    return motivos;
  }

  if (!resolved.isVatComputable) motivos.push("isVatComputable = false");
  if (!resolved.invoiceType) motivos.push("Falta invoiceType");
  else if (!isVatComputableInvoiceType(resolved.invoiceType)) {
    motivos.push(`invoiceType = ${resolved.invoiceType} (no es Factura A)`);
  }
  if (resolved.issuedToCompany !== true) {
    motivos.push(
      resolved.issuedToCompany === false ? "issuedToCompany = false" : "issuedToCompany no verificado"
    );
  }
  if (!resolved.supplierCuit?.trim()) motivos.push("Falta CUIT proveedor");
  if (!resolved.posNumber?.trim()) motivos.push("Falta punto de venta");
  if (!resolved.invoiceNumber?.trim()) motivos.push("Falta número de comprobante");
  if (!(resolved.netTaxedAmount > 0)) motivos.push("Falta neto gravado");
  if (!(totalVatAmount(resolved) > 0)) motivos.push("Falta IVA discriminado");

  return motivos;
}

export function auditPagoItem(
  doc: { id: string; data: () => Record<string, unknown> },
  year: number,
  month: number
): PagoAuditItem {
  const raw = pagoDocToRecord(doc.id, doc.data());
  const resolved = resolvePagoForIvaExport(raw);
  const effDate = pagoEffectiveInvoiceDate(resolved);
  const inPer = inPeriod(effDate, year, month);

  const resolvedMotivos = inPer ? diagnoseResolvedExclusionMotivos(resolved, year, month) : [];
  const exportable = inPer && isPagoExportableToIvaCompras(candidateFromResolved(resolved));

  let status: PagoAuditStatus = "EXCLUIDO";
  let motivos = resolvedMotivos;

  if (!inPer) {
    motivos = [`Fuera del período contable ${year}-${String(month).padStart(2, "0")} (fecha: ${effDate || "—"})`];
  } else if (exportable) {
    status = resolved.usedLegacyFallback ? "INFERIDO_PENDIENTE_REVISION" : "INCLUIDO";
    motivos = resolved.usedLegacyFallback
      ? [`Incluido vía inferencia legacy (${resolved.legacyInference.inferredFields.join(", ")}) — requiere revisión`]
      : ["Cumple todos los criterios de exportación IVA Compras"];
  } else if (resolved.usedLegacyFallback) {
    motivos = [
      ...resolvedMotivos,
      `(Inferencia parcial: ${resolved.legacyInference.inferredFields.join(", ")})`,
    ];
  }

  const looksFacturaA =
    raw.invoiceType === "factura_a" ||
    inferLegacyFiscalFields(raw).invoiceType === "factura_a";

  const vatForPotential = looksFacturaA
    ? totalVatAmount(resolved) > 0
      ? totalVatAmount(resolved)
      : suggestVat21FromTotal(resolved.totalAmount).vat21Amount
    : 0;

  return {
    id: raw.id,
    concepto: raw.concepto,
    proveedor: raw.supplierName || raw.proveedor,
    totalAmount: raw.totalAmount,
    paymentDate: raw.paymentDate,
    invoiceDateEffective: effDate,
    tienePdf: Boolean(raw.pdfStoragePath ?? resolved.legacyInference.pdfStoragePath),
    invoiceTypeStored: raw.invoiceType,
    invoiceTypeEffective: resolved.invoiceType,
    isVatComputableStored: raw.isVatComputable,
    isVatComputableEffective: resolved.isVatComputable,
    issuedToCompanyEffective: resolved.issuedToCompany,
    status,
    motivos,
    ivaPotencialPerdido: exportable ? 0 : vatForPotential,
    legacyInference: resolved.legacyInference,
    usedLegacyFallback: resolved.usedLegacyFallback,
    exportableAfterResolve: exportable,
  };
}

export function buildIvaAuditReport(
  pagosDocs: { id: string; data: () => Record<string, unknown> }[],
  year: number,
  month: number,
  facturasComprasExportadas = 0
): IvaAuditReport {
  const allItems = pagosDocs.map((d) => auditPagoItem(d, year, month));
  const gastos = allItems.filter((g) => !g.motivos.some((m) => m.startsWith("Fuera del período")));

  const lineasTexto: string[] = [];
  for (const g of allItems) {
    lineasTexto.push(`Gasto ${g.id}`);
    lineasTexto.push(`  Concepto: ${g.concepto}`);
    lineasTexto.push(`  Proveedor: ${g.proveedor || "—"}`);
    lineasTexto.push(`  Importe: $${g.totalAmount.toLocaleString("es-AR")}`);
    lineasTexto.push(`  Estado: ${g.status}`);
    for (const m of g.motivos) {
      lineasTexto.push(`  Motivo: ${m}`);
    }
    if (g.usedLegacyFallback) {
      lineasTexto.push(`  Inferencia: ${g.legacyInference.inferredFields.join(", ")}`);
    }
    lineasTexto.push("");
  }

  const exportados = gastos.filter((g) => g.exportableAfterResolve);
  const ivaExportable = exportados.reduce((s, g) => {
    const doc = pagosDocs.find((d) => d.id === g.id);
    if (!doc) return s;
    const resolved = resolvePagoForIvaExport(pagoDocToRecord(g.id, doc.data()));
    return s + totalVatAmount(resolved);
  }, 0);

  return {
    periodo: { year, month, key: `${year}-${String(month).padStart(2, "0")}` },
    resumen: {
      totalGastosPeriodo: gastos.length,
      gastosConPdf: gastos.filter((g) => g.tienePdf).length,
      gastosFacturaAStored: gastos.filter((g) => g.invoiceTypeStored === "factura_a").length,
      gastosFacturaAEffective: gastos.filter((g) => g.invoiceTypeEffective === "factura_a").length,
      gastosIvaComputableStored: gastos.filter((g) => g.isVatComputableStored).length,
      gastosIvaComputableEffective: gastos.filter((g) => g.isVatComputableEffective).length,
      gastosExportados: exportados.length,
      gastosExcluidos: gastos.filter((g) => !g.exportableAfterResolve).length,
      gastosInferidosPendientes: exportados.filter((g) => g.status === "INFERIDO_PENDIENTE_REVISION").length,
      ivaCreditoPotencialPerdido: gastos
        .filter((g) => !g.exportableAfterResolve)
        .reduce((s, g) => s + g.ivaPotencialPerdido, 0),
      ivaCreditoExportable: ivaExportable,
      facturasCompraExportadas: facturasComprasExportadas,
    },
    gastos,
    lineasTexto,
  };
}

export function pagosComprasForPeriodWithFallback(
  docs: { id: string; data: () => Record<string, unknown> }[],
  year: number,
  month: number
): {
  exportables: NormalizedFact[];
  items: PagoAuditItem[];
  ivaCredito21: number;
  ivaCredito105: number;
  ivaCredito27: number;
  netoGravado: number;
  count: number;
} {
  const exportables: NormalizedFact[] = [];
  const items: PagoAuditItem[] = [];
  let ivaCredito21 = 0;
  let ivaCredito105 = 0;
  let ivaCredito27 = 0;
  let netoGravado = 0;

  for (const doc of docs) {
    const item = auditPagoItem(doc, year, month);
    items.push(item);
    if (!item.exportableAfterResolve) continue;

    const resolved = resolvePagoForIvaExport(pagoDocToRecord(doc.id, doc.data()));
    const norm = pagoToNormalizedFact(resolved);
    if (!norm) continue;

    exportables.push(norm);
    ivaCredito21 += resolved.vat21Amount;
    ivaCredito105 += resolved.vat105Amount;
    ivaCredito27 += resolved.vat27Amount;
    netoGravado += resolved.netTaxedAmount;
  }

  return {
    exportables,
    items,
    ivaCredito21,
    ivaCredito105,
    ivaCredito27,
    netoGravado,
    count: exportables.length,
  };
}
