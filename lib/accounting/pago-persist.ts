import { Timestamp } from "firebase-admin/firestore";
import type { NormalizedFact } from "@/lib/arca-export/iva-lines";
import {
  defaultFiscalFromLegacy,
  invoiceTypeToTipoComprobante,
  normalizeCuitDigits,
  totalVatAmount,
  type InvoiceType,
  type PaidBy,
  type SupplierVatCondition,
  type AccountingCategory,
} from "@/lib/accounting/pago-fiscal";
import { dateOnlyToUtcMidday } from "@/lib/accounting/dates";
import { fechaFieldToUi, toIso } from "@/lib/accounting/serialize";

export type PagoFirestoreDoc = Record<string, unknown>;

function strOrEmpty(v: unknown): string {
  return v != null ? String(v).trim() : "";
}

function numOrZero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function optEnum<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  const s = strOrEmpty(v);
  if (!s) return null;
  return (allowed as readonly string[]).includes(s) ? (s as T) : null;
}

function fechaFromDocField(val: unknown): string {
  const iso = toIso(val);
  if (iso) return fechaFieldToUi(iso);
  if (typeof val === "string" && val.trim()) {
    const d = new Date(val.trim());
    if (!Number.isNaN(d.getTime())) return fechaFieldToUi(d.toISOString());
    if (/^\d{4}-\d{2}-\d{2}$/.test(val.trim())) return val.trim();
  }
  return "";
}

function boolOrNull(v: unknown): boolean | null {
  if (v === true || v === false) return v;
  return null;
}

/** Lee documento Firestore y devuelve registro unificado (legacy + fiscal). */
export function pagoDocToRecord(id: string, d: PagoFirestoreDoc) {
  const legacy = defaultFiscalFromLegacy({
    fecha: fechaFromDocField(d.fecha),
    importe: numOrZero(d.importe ?? d.totalAmount),
    concepto: strOrEmpty(d.concepto),
    proveedor: strOrEmpty(d.proveedor ?? d.supplierName),
    medio: d.medio != null ? String(d.medio) : d.paymentMethod != null ? String(d.paymentMethod) : null,
    observaciones: strOrEmpty(d.observaciones ?? d.notes),
    facturaId: d.facturaId != null ? String(d.facturaId) : null,
    pdfStoragePath: d.pdfStoragePath != null ? String(d.pdfStoragePath) : null,
  });

  const paymentDate = fechaFromDocField(d.paymentDate) || legacy.paymentDate;
  const invoiceDateRaw = d.invoiceDate != null ? fechaFromDocField(d.invoiceDate) : legacy.invoiceDate;
  const totalAmount = d.totalAmount != null ? numOrZero(d.totalAmount) : legacy.totalAmount;

  return {
    id,
    fecha: paymentDate,
    importe: totalAmount,
    concepto: strOrEmpty(d.concepto),
    proveedor: strOrEmpty(d.proveedor ?? d.supplierName) || legacy.supplierName,
    medio: d.medio != null ? String(d.medio) : legacy.paymentMethod,
    observaciones: strOrEmpty(d.observaciones ?? d.notes),
    facturaId: d.facturaId != null ? String(d.facturaId) : "",
    bankReference: d.bankReference ? String(d.bankReference) : "",
    bankReferencia: d.bankReferencia ? String(d.bankReferencia) : "",
    invoiceType: optEnum<InvoiceType>(d.invoiceType, [
      "factura_a",
      "factura_b",
      "factura_c",
      "ticket",
      "recibo",
      "sin_comprobante",
      "otro",
    ]),
    posNumber: strOrEmpty(d.posNumber),
    invoiceNumber: strOrEmpty(d.invoiceNumber),
    supplierCuit: normalizeCuitDigits(strOrEmpty(d.supplierCuit)),
    supplierName: strOrEmpty(d.supplierName ?? d.proveedor) || legacy.supplierName,
    supplierVatCondition: optEnum<SupplierVatCondition>(d.supplierVatCondition, [
      "responsable_inscripto",
      "monotributo",
      "exento",
      "consumidor_final",
      "otro",
    ]),
    invoiceDate: invoiceDateRaw || null,
    paymentDate,
    totalAmount,
    netTaxedAmount: d.netTaxedAmount != null ? numOrZero(d.netTaxedAmount) : legacy.netTaxedAmount,
    vat21Amount: d.vat21Amount != null ? numOrZero(d.vat21Amount) : legacy.vat21Amount,
    vat105Amount: d.vat105Amount != null ? numOrZero(d.vat105Amount) : legacy.vat105Amount,
    vat27Amount: d.vat27Amount != null ? numOrZero(d.vat27Amount) : legacy.vat27Amount,
    exemptAmount: d.exemptAmount != null ? numOrZero(d.exemptAmount) : legacy.exemptAmount,
    vatPerceptionAmount: d.vatPerceptionAmount != null ? numOrZero(d.vatPerceptionAmount) : legacy.vatPerceptionAmount,
    grossIncomePerceptionAmount:
      d.grossIncomePerceptionAmount != null ? numOrZero(d.grossIncomePerceptionAmount) : legacy.grossIncomePerceptionAmount,
    otherTaxesAmount: d.otherTaxesAmount != null ? numOrZero(d.otherTaxesAmount) : legacy.otherTaxesAmount,
    accountingCategory: optEnum<AccountingCategory>(d.accountingCategory, [
      "insumos",
      "servicios",
      "honorarios",
      "alquiler",
      "sueldos",
      "impuestos",
      "equipamiento",
      "marketing",
      "aporte_reintegro_socio",
      "otro",
    ]),
    paymentMethod: d.paymentMethod != null ? String(d.paymentMethod) : legacy.paymentMethod,
    paidBy: optEnum<PaidBy>(d.paidBy, [
      "cuenta_empresa",
      "tarjeta_empresa",
      "tarjeta_personal_socio",
      "efectivo_socio",
      "otro",
    ]),
    isVatComputable: d.isVatComputable === true,
    isIncomeTaxDeductible: d.isIncomeTaxDeductible === true,
    issuedToCompany: boolOrNull(d.issuedToCompany),
    pdfStoragePath: d.pdfStoragePath != null ? String(d.pdfStoragePath) : legacy.pdfStoragePath,
    notes: strOrEmpty(d.notes ?? d.observaciones),
  };
}

export type PagoBodyInput = {
  fecha: string;
  importe: number;
  concepto: string;
  proveedor?: string;
  medio?: string;
  facturaId?: string;
  observaciones?: string;
  invoiceType?: InvoiceType | null;
  posNumber?: string;
  invoiceNumber?: string;
  supplierCuit?: string;
  supplierName?: string;
  supplierVatCondition?: SupplierVatCondition | null;
  invoiceDate?: string | null;
  paymentDate?: string;
  totalAmount?: number;
  netTaxedAmount?: number;
  vat21Amount?: number;
  vat105Amount?: number;
  vat27Amount?: number;
  exemptAmount?: number;
  vatPerceptionAmount?: number;
  grossIncomePerceptionAmount?: number;
  otherTaxesAmount?: number;
  accountingCategory?: AccountingCategory | null;
  paymentMethod?: string;
  paidBy?: PaidBy | null;
  isVatComputable?: boolean;
  isIncomeTaxDeductible?: boolean;
  issuedToCompany?: boolean | null;
  pdfStoragePath?: string | null;
  notes?: string;
};

/** Convierte body validado a campos Firestore. */
export function pagoBodyToFirestore(row: PagoBodyInput) {
  const paymentDate = row.paymentDate ?? row.fecha;
  const totalAmount = row.totalAmount ?? row.importe;
  const supplierName = (row.supplierName ?? row.proveedor ?? "").trim();
  const notes = (row.notes ?? row.observaciones ?? "").trim();
  const paymentMethod = row.paymentMethod ?? row.medio ?? null;

  return {
    fecha: paymentDate,
    importe: totalAmount,
    concepto: row.concepto.trim(),
    proveedor: supplierName || null,
    medio: paymentMethod,
    facturaId: row.facturaId?.trim() || null,
    observaciones: notes || null,
    invoiceType: row.invoiceType ?? null,
    posNumber: row.posNumber?.trim() || null,
    invoiceNumber: row.invoiceNumber?.trim() || null,
    supplierCuit: normalizeCuitDigits(row.supplierCuit ?? "") || null,
    supplierName: supplierName || null,
    supplierVatCondition: row.supplierVatCondition ?? null,
    invoiceDate: row.invoiceDate?.trim() || null,
    paymentDate,
    totalAmount,
    netTaxedAmount: row.netTaxedAmount ?? 0,
    vat21Amount: row.vat21Amount ?? 0,
    vat105Amount: row.vat105Amount ?? 0,
    vat27Amount: row.vat27Amount ?? 0,
    exemptAmount: row.exemptAmount ?? 0,
    vatPerceptionAmount: row.vatPerceptionAmount ?? 0,
    grossIncomePerceptionAmount: row.grossIncomePerceptionAmount ?? 0,
    otherTaxesAmount: row.otherTaxesAmount ?? 0,
    accountingCategory: row.accountingCategory ?? null,
    paymentMethod,
    paidBy: row.paidBy ?? null,
    isVatComputable: row.isVatComputable === true,
    isIncomeTaxDeductible: row.isIncomeTaxDeductible === true,
    issuedToCompany: row.issuedToCompany ?? null,
    pdfStoragePath: row.pdfStoragePath ?? null,
    notes: notes || null,
  };
}

/** Convierte fechas string a Timestamp para persistencia. */
export function pagoFirestoreWithTimestamps(
  row: ReturnType<typeof pagoBodyToFirestore>,
  paymentDateTs: Timestamp
) {
  const invoiceTs =
    row.invoiceDate && /^\d{4}-\d{2}-\d{2}$/.test(row.invoiceDate)
      ? Timestamp.fromDate(dateOnlyToUtcMidday(row.invoiceDate))
      : null;

  return {
    ...row,
    fecha: paymentDateTs,
    paymentDate: paymentDateTs,
    invoiceDate: invoiceTs,
  };
}

/** Normaliza un pago computable para Libro IVA Compras. */
export function pagoToNormalizedFact(rec: ReturnType<typeof pagoDocToRecord>): NormalizedFact | null {
  const fechaIso = rec.invoiceDate
    ? `${rec.invoiceDate}T12:00:00.000Z`
    : rec.paymentDate
      ? `${rec.paymentDate}T12:00:00.000Z`
      : null;
  if (!fechaIso || !rec.invoiceType) return null;

  const iva = totalVatAmount(rec);
  const otros =
    (rec.vatPerceptionAmount || 0) + (rec.grossIncomePerceptionAmount || 0) + (rec.otherTaxesAmount || 0);

  return {
    id: `pago_${rec.id}`,
    fechaIso,
    tipo: "compra",
    numero: rec.invoiceNumber,
    puntoVenta: rec.posNumber || "0",
    razonsocial: rec.supplierName || "NO INFORMADO",
    cuit: rec.supplierCuit,
    tipoComprobante: invoiceTypeToTipoComprobante(rec.invoiceType),
    netoGravado: rec.netTaxedAmount,
    iva,
    otrosImpuestos: otros,
    total: rec.totalAmount,
  };
}
