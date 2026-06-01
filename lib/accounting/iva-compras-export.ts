import type { NormalizedFact } from "@/lib/arca-export/iva-lines";
import { isPagoExportableToIvaCompras, type PagoExportCandidate } from "@/lib/accounting/pago-fiscal";
import { pagoDocToRecord, pagoToNormalizedFact } from "@/lib/accounting/pago-persist";

export type ComprasIvaResumen = {
  netoGravadoCompras: number;
  ivaCredito21: number;
  ivaCredito105: number;
  ivaCredito27: number;
  totalIvaCredito: number;
  percepcionesIva: number;
  percepcionesIibb: number;
  totalComprobantesComputables: number;
  totalGastosNoComputables: number;
  desdeFacturas: number;
  desdePagos: number;
};

function inPeriod(ymd: string | null, year: number, month: number): boolean {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [y, m] = ymd.split("-").map((x) => parseInt(x, 10));
  return y === year && m === month;
}

/** Fecha efectiva del comprobante para asignación al período IVA. */
export function pagoEffectiveInvoiceDate(rec: ReturnType<typeof pagoDocToRecord>): string {
  return rec.invoiceDate ?? rec.paymentDate ?? rec.fecha;
}

export function pagosComprasForPeriod(
  docs: { id: string; data: () => Record<string, unknown> }[],
  year: number,
  month: number
): {
  exportables: NormalizedFact[];
  resumen: ComprasIvaResumen;
  candidatos: PagoExportCandidate[];
} {
  let netoGravadoCompras = 0;
  let ivaCredito21 = 0;
  let ivaCredito105 = 0;
  let ivaCredito27 = 0;
  let percepcionesIva = 0;
  let percepcionesIibb = 0;
  let totalComprobantesComputables = 0;
  let totalGastosNoComputables = 0;

  const exportables: NormalizedFact[] = [];

  for (const doc of docs) {
    const rec = pagoDocToRecord(doc.id, doc.data());
    const effDate = pagoEffectiveInvoiceDate(rec);
    if (!inPeriod(effDate, year, month)) continue;

    const candidate: PagoExportCandidate = {
      id: rec.id,
      invoiceDate: effDate,
      paymentDate: rec.paymentDate,
      invoiceType: rec.invoiceType,
      posNumber: rec.posNumber,
      invoiceNumber: rec.invoiceNumber,
      supplierCuit: rec.supplierCuit,
      supplierName: rec.supplierName,
      isVatComputable: rec.isVatComputable,
      issuedToCompany: rec.issuedToCompany,
      totalAmount: rec.totalAmount,
      netTaxedAmount: rec.netTaxedAmount,
      vat21Amount: rec.vat21Amount,
      vat105Amount: rec.vat105Amount,
      vat27Amount: rec.vat27Amount,
      vatPerceptionAmount: rec.vatPerceptionAmount,
      grossIncomePerceptionAmount: rec.grossIncomePerceptionAmount,
      otherTaxesAmount: rec.otherTaxesAmount,
      exemptAmount: rec.exemptAmount,
    };

    if (isPagoExportableToIvaCompras(candidate)) {
      const norm = pagoToNormalizedFact(rec);
      if (norm) {
        exportables.push(norm);
        totalComprobantesComputables += 1;
        netoGravadoCompras += rec.netTaxedAmount;
        ivaCredito21 += rec.vat21Amount;
        ivaCredito105 += rec.vat105Amount;
        ivaCredito27 += rec.vat27Amount;
        percepcionesIva += rec.vatPerceptionAmount;
        percepcionesIibb += rec.grossIncomePerceptionAmount;
      }
    } else {
      totalGastosNoComputables += 1;
    }
  }

  const totalIvaCredito = ivaCredito21 + ivaCredito105 + ivaCredito27;

  return {
    exportables,
    candidatos: [],
    resumen: {
      netoGravadoCompras,
      ivaCredito21,
      ivaCredito105,
      ivaCredito27,
      totalIvaCredito,
      percepcionesIva,
      percepcionesIibb,
      totalComprobantesComputables,
      totalGastosNoComputables,
      desdeFacturas: 0,
      desdePagos: totalComprobantesComputables,
    },
  };
}

export function mergeComprasNormalized(
  facturasCompras: NormalizedFact[],
  pagosCompras: NormalizedFact[]
): NormalizedFact[] {
  return [...facturasCompras, ...pagosCompras].sort((a, b) => a.fechaIso.localeCompare(b.fechaIso));
}

export function sumComprasResumen(
  fromFacturas: { neto: number; iva21: number; iva105: number; iva27: number; count: number },
  fromPagos: ComprasIvaResumen
): ComprasIvaResumen {
  return {
    netoGravadoCompras: fromFacturas.neto + fromPagos.netoGravadoCompras,
    ivaCredito21: fromFacturas.iva21 + fromPagos.ivaCredito21,
    ivaCredito105: fromFacturas.iva105 + fromPagos.ivaCredito105,
    ivaCredito27: fromFacturas.iva27 + fromPagos.ivaCredito27,
    totalIvaCredito:
      fromFacturas.iva21 +
      fromFacturas.iva105 +
      fromFacturas.iva27 +
      fromPagos.totalIvaCredito,
    percepcionesIva: fromPagos.percepcionesIva,
    percepcionesIibb: fromPagos.percepcionesIibb,
    totalComprobantesComputables: fromFacturas.count + fromPagos.totalComprobantesComputables,
    totalGastosNoComputables: fromPagos.totalGastosNoComputables,
    desdeFacturas: fromFacturas.count,
    desdePagos: fromPagos.totalComprobantesComputables,
  };
}
