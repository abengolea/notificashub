import {
  suggestVat21FromTotal,
  type InvoiceType,
  type PagoFiscalCore,
} from "@/lib/accounting/pago-fiscal";
import type { pagoDocToRecord } from "@/lib/accounting/pago-persist";

type PagoRec = ReturnType<typeof pagoDocToRecord>;
export function extractPdfPathFromObservaciones(obs: string): string | null {
  const m = obs.match(/PDF:\s*gs:\/\/[^/]+\/(.+?)(?:\s|$|\n)/i);
  if (m?.[1]) return m[1].trim();
  return null;
}

const FACTURA_A_PATTERNS = [
  /\bfactura\s*a\b/i,
  /\bfa\b/i,
  /\bfact\.\s*a\b/i,
  /\bcomprobante\s*a\b/i,
];

const FACTURA_B_PATTERNS = [/\bfactura\s*b\b/i, /\bfb\b/i];
const FACTURA_C_PATTERNS = [/\bfactura\s*c\b/i, /\bfc\b/i];

export function detectInvoiceTypeFromText(text: string): InvoiceType | null {
  const t = text.trim();
  if (!t) return null;
  if (FACTURA_A_PATTERNS.some((p) => p.test(t))) return "factura_a";
  if (FACTURA_B_PATTERNS.some((p) => p.test(t))) return "factura_b";
  if (FACTURA_C_PATTERNS.some((p) => p.test(t))) return "factura_c";
  if (/sin\s+comprobante/i.test(t)) return "sin_comprobante";
  if (/\bticket\b/i.test(t)) return "ticket";
  if (/\brecibo\b/i.test(t)) return "recibo";
  return null;
}

/** Intenta extraer PV-Número desde texto (ej. "00001-00001234" o "PV 1 Nº 123"). */
export function parsePosAndNumberFromText(text: string): { posNumber: string; invoiceNumber: string } {
  const joined = text.replace(/\s+/g, " ");
  const m1 = joined.match(/(\d{4,5})\s*[-–]\s*(\d{4,8})/);
  if (m1) {
    return { posNumber: m1[1]!, invoiceNumber: m1[2]! };
  }
  const m2 = joined.match(/(?:pv|p\.?\s*v\.?|punto\s+de\s+venta)[:\s]*(\d+)[^\d]+(?:n[°º.]?\s*|num(?:ero)?[:\s]*)(\d+)/i);
  if (m2) {
    return { posNumber: m2[1]!, invoiceNumber: m2[2]! };
  }
  return { posNumber: "", invoiceNumber: "" };
}

/** Intenta extraer CUIT de 11 dígitos desde texto. */
export function extractCuitFromText(text: string): string {
  const m = text.match(/\b(\d{2}[-\s]?\d{8}[-\s]?\d|\d{11})\b/);
  if (!m?.[1]) return "";
  return m[1].replace(/\D/g, "").slice(0, 11);
}

export type LegacyInferenceResult = {
  invoiceType: InvoiceType | null;
  posNumber: string;
  invoiceNumber: string;
  supplierCuit: string;
  invoiceDate: string | null;
  netTaxedAmount: number;
  vat21Amount: number;
  vat105Amount: number;
  vat27Amount: number;
  isVatComputable: boolean;
  issuedToCompany: boolean | null;
  pdfStoragePath: string | null;
  inferredFields: string[];
  needsManualReview: boolean;
  inferenceSource: ("observaciones" | "total" | "paymentDate" | "pdfPath")[];
};

/** Reconstruye campos fiscales ausentes en gastos legacy. No persiste — solo resuelve estado efectivo. */
export function inferLegacyFiscalFields(rec: PagoRec): LegacyInferenceResult {
  const textBlob = [rec.observaciones, rec.notes, rec.concepto].filter(Boolean).join(" ");
  const inferredFields: string[] = [];
  const inferenceSource: LegacyInferenceResult["inferenceSource"] = [];
  let needsManualReview = false;

  let invoiceType = rec.invoiceType;
  if (!invoiceType) {
    const detected = detectInvoiceTypeFromText(textBlob);
    if (detected) {
      invoiceType = detected;
      inferredFields.push("invoiceType");
      inferenceSource.push("observaciones");
      needsManualReview = true;
    }
  }

  let pdfStoragePath = rec.pdfStoragePath;
  if (!pdfStoragePath) {
    const fromObs = extractPdfPathFromObservaciones(rec.observaciones);
    if (fromObs) {
      pdfStoragePath = fromObs;
      inferredFields.push("pdfStoragePath");
      inferenceSource.push("pdfPath");
    }
  }

  let posNumber = rec.posNumber;
  let invoiceNumber = rec.invoiceNumber;
  if (!posNumber || !invoiceNumber) {
    const parsed = parsePosAndNumberFromText(textBlob);
    if (!posNumber && parsed.posNumber) {
      posNumber = parsed.posNumber;
      inferredFields.push("posNumber");
      inferenceSource.push("observaciones");
      needsManualReview = true;
    }
    if (!invoiceNumber && parsed.invoiceNumber) {
      invoiceNumber = parsed.invoiceNumber;
      inferredFields.push("invoiceNumber");
      inferenceSource.push("observaciones");
      needsManualReview = true;
    }
  }

  let supplierCuit = rec.supplierCuit;
  if (!supplierCuit) {
    const fromText = extractCuitFromText(textBlob);
    if (fromText.length === 11) {
      supplierCuit = fromText;
      inferredFields.push("supplierCuit");
      inferenceSource.push("observaciones");
      needsManualReview = true;
    }
  }

  let invoiceDate = rec.invoiceDate;
  if (!invoiceDate && rec.paymentDate) {
    invoiceDate = rec.paymentDate;
    inferredFields.push("invoiceDate");
    inferenceSource.push("paymentDate");
  }

  let netTaxedAmount = rec.netTaxedAmount;
  let vat21Amount = rec.vat21Amount;
  const vat105Amount = rec.vat105Amount;
  const vat27Amount = rec.vat27Amount;

  const total = rec.totalAmount || rec.importe;
  const hasVat = (rec.vat21Amount || 0) + (rec.vat105Amount || 0) + (rec.vat27Amount || 0) > 0;

  if (invoiceType === "factura_a" && total > 0 && (!hasVat || netTaxedAmount <= 0)) {
    const suggested = suggestVat21FromTotal(total);
    if (netTaxedAmount <= 0) {
      netTaxedAmount = suggested.netTaxedAmount;
      inferredFields.push("netTaxedAmount");
    }
    if (vat21Amount <= 0) {
      vat21Amount = suggested.vat21Amount;
      inferredFields.push("vat21Amount");
    }
    inferenceSource.push("total");
    needsManualReview = true;
  }

  let isVatComputable = rec.isVatComputable;
  if (!isVatComputable && invoiceType === "factura_a" && netTaxedAmount > 0 && vat21Amount > 0) {
    isVatComputable = true;
    inferredFields.push("isVatComputable");
    needsManualReview = true;
  }

  let issuedToCompany = rec.issuedToCompany;
  if (issuedToCompany == null && invoiceType === "factura_a" && isVatComputable) {
    issuedToCompany = true;
    inferredFields.push("issuedToCompany");
    needsManualReview = true;
  }

  return {
    invoiceType,
    posNumber,
    invoiceNumber,
    supplierCuit,
    invoiceDate,
    netTaxedAmount,
    vat21Amount,
    vat105Amount,
    vat27Amount,
    isVatComputable,
    issuedToCompany,
    pdfStoragePath,
    inferredFields,
    needsManualReview,
    inferenceSource,
  };
}

/** Fusiona registro Firestore + inferencia legacy → estado efectivo para export/auditoría. */
export function resolvePagoForIvaExport(rec: PagoRec): PagoRec & {
  legacyInference: LegacyInferenceResult;
  usedLegacyFallback: boolean;
} {
  const inf = inferLegacyFiscalFields(rec);
  const usedLegacyFallback = inf.inferredFields.length > 0;

  return {
    ...rec,
    invoiceType: rec.invoiceType ?? inf.invoiceType,
    posNumber: rec.posNumber || inf.posNumber,
    invoiceNumber: rec.invoiceNumber || inf.invoiceNumber,
    supplierCuit: rec.supplierCuit || inf.supplierCuit,
    invoiceDate: rec.invoiceDate ?? inf.invoiceDate,
    netTaxedAmount: rec.netTaxedAmount > 0 ? rec.netTaxedAmount : inf.netTaxedAmount,
    vat21Amount: rec.vat21Amount > 0 ? rec.vat21Amount : inf.vat21Amount,
    vat105Amount: rec.vat105Amount > 0 ? rec.vat105Amount : inf.vat105Amount,
    vat27Amount: rec.vat27Amount > 0 ? rec.vat27Amount : inf.vat27Amount,
    isVatComputable: rec.isVatComputable || inf.isVatComputable,
    issuedToCompany: rec.issuedToCompany ?? inf.issuedToCompany,
    pdfStoragePath: rec.pdfStoragePath ?? inf.pdfStoragePath,
    legacyInference: inf,
    usedLegacyFallback,
  };
}

export type ResolvedPagoFiscal = ReturnType<typeof resolvePagoForIvaExport>;

/** Convierte pago resuelto a shape mínimo PagoFiscalCore para normalized fact. */
export function resolvedToFiscalCore(resolved: ResolvedPagoFiscal): Pick<
  PagoFiscalCore,
  | "invoiceType"
  | "posNumber"
  | "invoiceNumber"
  | "supplierCuit"
  | "supplierName"
  | "invoiceDate"
  | "paymentDate"
  | "totalAmount"
  | "netTaxedAmount"
  | "vat21Amount"
  | "vat105Amount"
  | "vat27Amount"
  | "vatPerceptionAmount"
  | "grossIncomePerceptionAmount"
  | "otherTaxesAmount"
> {
  return {
    invoiceType: resolved.invoiceType,
    posNumber: resolved.posNumber,
    invoiceNumber: resolved.invoiceNumber,
    supplierCuit: resolved.supplierCuit,
    supplierName: resolved.supplierName,
    invoiceDate: resolved.invoiceDate,
    paymentDate: resolved.paymentDate,
    totalAmount: resolved.totalAmount,
    netTaxedAmount: resolved.netTaxedAmount,
    vat21Amount: resolved.vat21Amount,
    vat105Amount: resolved.vat105Amount,
    vat27Amount: resolved.vat27Amount,
    vatPerceptionAmount: resolved.vatPerceptionAmount,
    grossIncomePerceptionAmount: resolved.grossIncomePerceptionAmount,
    otherTaxesAmount: resolved.otherTaxesAmount,
  };
}
