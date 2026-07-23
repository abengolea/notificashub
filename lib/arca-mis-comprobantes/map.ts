import type { MisComprobanteRow } from "@/lib/arca-mis-comprobantes/parse";
import type { InvoiceType } from "@/lib/accounting/pago-fiscal";

/** Código WSFE → tipo interno hub. */
export function cbteTipoToHub(tipoCodigo: number): {
  tipoComprobante: "A" | "B" | "C" | "credito_a" | "credito_b" | "credito_c" | "otro";
  invoiceType: InvoiceType;
  esNotaCredito: boolean;
} {
  const map: Record<
    number,
    { tipoComprobante: "A" | "B" | "C" | "credito_a" | "credito_b" | "credito_c"; invoiceType: InvoiceType }
  > = {
    1: { tipoComprobante: "A", invoiceType: "factura_a" },
    2: { tipoComprobante: "A", invoiceType: "factura_a" },
    3: { tipoComprobante: "credito_a", invoiceType: "factura_a" },
    6: { tipoComprobante: "B", invoiceType: "factura_b" },
    7: { tipoComprobante: "B", invoiceType: "factura_b" },
    8: { tipoComprobante: "credito_b", invoiceType: "factura_b" },
    11: { tipoComprobante: "C", invoiceType: "factura_c" },
    12: { tipoComprobante: "C", invoiceType: "factura_c" },
    13: { tipoComprobante: "credito_c", invoiceType: "factura_c" },
  };
  const hit = map[tipoCodigo];
  if (!hit) {
    return { tipoComprobante: "otro", invoiceType: "otro", esNotaCredito: false };
  }
  return {
    ...hit,
    esNotaCredito: hit.tipoComprobante.startsWith("credito"),
  };
}

export function misComprobanteDedupeKey(row: MisComprobanteRow): string {
  const side = row.kind === "emitido" ? "E" : "R";
  return `${side}|${row.tipoCodigo}|${row.puntoVenta}|${row.numero}|${row.contraparteCuit || "0"}`;
}

/** Signo para montos (NC restan en agregados; en registros guardamos absoluto + tipo credito). */
export function signedAmounts(row: MisComprobanteRow): {
  netoGravado: number;
  iva: number;
  total: number;
  otrosImpuestos: number;
} {
  const { esNotaCredito } = cbteTipoToHub(row.tipoCodigo);
  const sign = esNotaCredito ? -1 : 1;
  // Persistimos siempre positivos en Firestore; el tipoComprobante marca NC.
  void sign;
  return {
    netoGravado: Math.abs(row.netoGravado),
    iva: Math.abs(row.iva),
    total: Math.abs(row.total),
    otrosImpuestos: Math.abs(row.otrosTributos + row.netoNoGravado + row.opExentas),
  };
}

export function recibidosToPagoDraft(row: MisComprobanteRow) {
  const hub = cbteTipoToHub(row.tipoCodigo);
  const amts = signedAmounts(row);
  const isA = hub.invoiceType === "factura_a";
  return {
    concepto: `Mis Comprobantes ${hub.tipoComprobante} ${row.puntoVenta}-${row.numero}`,
    proveedor: row.contraparteNombre,
    invoiceType: hub.invoiceType,
    posNumber: row.puntoVenta,
    invoiceNumber: row.numero,
    supplierCuit: row.contraparteCuit,
    supplierName: row.contraparteNombre,
    supplierVatCondition: isA ? ("responsable_inscripto" as const) : ("otro" as const),
    invoiceDate: row.fecha,
    paymentDate: row.fecha,
    totalAmount: amts.total,
    netTaxedAmount: amts.netoGravado,
    vat21Amount: amts.iva,
    vat105Amount: 0,
    vat27Amount: 0,
    exemptAmount: Math.abs(row.opExentas),
    vatPerceptionAmount: 0,
    grossIncomePerceptionAmount: 0,
    otherTaxesAmount: Math.abs(row.otrosTributos),
    accountingCategory: "servicios" as const,
    isVatComputable: isA && amts.iva > 0,
    isIncomeTaxDeductible: true,
    issuedToCompany: true,
    notes: row.cae ? `CAE ${row.cae} · import Mis Comprobantes` : "Import Mis Comprobantes",
    arcaMisComprobantesKey: misComprobanteDedupeKey(row),
    cae: row.cae || null,
  };
}

export function emitidosToFacturaDraft(row: MisComprobanteRow) {
  const hub = cbteTipoToHub(row.tipoCodigo);
  const amts = signedAmounts(row);
  return {
    tipo: "venta" as const,
    numero: row.numero,
    puntoVenta: row.puntoVenta,
    fecha: row.fecha,
    razonsocial: row.contraparteNombre,
    cuit: row.contraparteCuit || undefined,
    tipoComprobante: hub.tipoComprobante,
    netoGravado: amts.netoGravado,
    iva: amts.iva,
    otrosImpuestos: amts.otrosImpuestos,
    total: amts.total,
    observaciones: row.cae ? `CAE ${row.cae} · Mis Comprobantes` : "Import Mis Comprobantes",
    arcaMisComprobantesKey: misComprobanteDedupeKey(row),
    cae: row.cae || null,
  };
}
