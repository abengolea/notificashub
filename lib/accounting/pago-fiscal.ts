import { BILLING_EMISOR } from "@/lib/billing/constants";

/** Tipos de comprobante para gastos / egresos. */
export const INVOICE_TYPES = [
  "factura_a",
  "factura_b",
  "factura_c",
  "ticket",
  "recibo",
  "vep",
  "sin_comprobante",
  "otro",
] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];

export const TAX_SUBCATEGORIES = [
  "iva",
  "iibb",
  "ganancias",
  "bienes_personales",
  "autonomos",
  "sellos",
  "otro_tributo",
] as const;
export type TaxSubcategory = (typeof TAX_SUBCATEGORIES)[number];

export const TAX_SUBCATEGORY_LABELS: Record<TaxSubcategory, string> = {
  iva: "IVA",
  iibb: "Ingresos Brutos",
  ganancias: "Ganancias",
  bienes_personales: "Bienes Personales",
  autonomos: "Autónomos",
  sellos: "Impuesto de sellos",
  otro_tributo: "Otro tributo",
};

/** IIBB y Autónomos son deducibles en Ganancias; IVA, BP y Ganancias no lo son. */
export const TAX_SUBCATEGORY_DEDUCTIBLE: Record<TaxSubcategory, boolean> = {
  iva: false,
  iibb: true,
  ganancias: false,
  bienes_personales: false,
  autonomos: true,
  sellos: true,
  otro_tributo: false,
};

export const SUPPLIER_VAT_CONDITIONS = [
  "responsable_inscripto",
  "monotributo",
  "exento",
  "consumidor_final",
  "otro",
] as const;
export type SupplierVatCondition = (typeof SUPPLIER_VAT_CONDITIONS)[number];

export const PAID_BY_OPTIONS = [
  "cuenta_empresa",
  "tarjeta_empresa",
  "tarjeta_personal_socio",
  "efectivo_socio",
  "otro",
] as const;
export type PaidBy = (typeof PAID_BY_OPTIONS)[number];

export const ACCOUNTING_CATEGORIES = [
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
] as const;
export type AccountingCategory = (typeof ACCOUNTING_CATEGORIES)[number];

/** Comprobantes que pueden generar crédito fiscal de IVA (Factura A o equivalente). */
export const VAT_COMPUTABLE_INVOICE_TYPES: readonly InvoiceType[] = ["factura_a"] as const;

export const NOTIFICAS_CUIT = BILLING_EMISOR.cuit;
export const NOTIFICAS_RAZON_SOCIAL = BILLING_EMISOR.razonSocial;

export type PagoFiscalAmounts = {
  totalAmount: number;
  netTaxedAmount: number;
  vat21Amount: number;
  vat105Amount: number;
  vat27Amount: number;
  exemptAmount: number;
  vatPerceptionAmount: number;
  grossIncomePerceptionAmount: number;
  otherTaxesAmount: number;
};

export type PagoFiscalCore = PagoFiscalAmounts & {
  invoiceType: InvoiceType | null;
  posNumber: string;
  invoiceNumber: string;
  supplierCuit: string;
  supplierName: string;
  supplierVatCondition: SupplierVatCondition | null;
  invoiceDate: string | null;
  paymentDate: string;
  accountingCategory: AccountingCategory | null;
  paymentMethod: string | null;
  paidBy: PaidBy | null;
  isVatComputable: boolean;
  isIncomeTaxDeductible: boolean;
  issuedToCompany: boolean | null;
  pdfStoragePath: string | null;
  notes: string;
};

export type PagoLegacyFields = {
  /** Alias legacy — misma fecha que paymentDate. */
  fecha: string;
  /** Alias legacy — mismo importe que totalAmount. */
  importe: number;
  concepto: string;
  proveedor: string;
  medio: string | null;
  observaciones: string;
  facturaId: string | null;
};

export type PagoFiscalRecord = PagoFiscalCore & PagoLegacyFields;

export type PagoAlert = {
  level: "info" | "warning" | "error";
  message: string;
};

export function normalizeCuitDigits(raw: string | null | undefined): string {
  return String(raw ?? "")
    .replace(/\D/g, "")
    .slice(0, 11);
}

export function cuitsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = normalizeCuitDigits(a);
  const db = normalizeCuitDigits(b);
  return da.length === 11 && db.length === 11 && da === db;
}

export function isVatComputableInvoiceType(type: InvoiceType | null | undefined): boolean {
  return type != null && (VAT_COMPUTABLE_INVOICE_TYPES as readonly string[]).includes(type);
}

export function totalVatAmount(amounts: Pick<PagoFiscalAmounts, "vat21Amount" | "vat105Amount" | "vat27Amount">): number {
  return (amounts.vat21Amount || 0) + (amounts.vat105Amount || 0) + (amounts.vat27Amount || 0);
}

/** Sugiere neto e IVA 21% desde un total con IVA incluido. */
export function suggestVat21FromTotal(total: number): { netTaxedAmount: number; vat21Amount: number } {
  if (!Number.isFinite(total) || total <= 0) {
    return { netTaxedAmount: 0, vat21Amount: 0 };
  }
  const netTaxedAmount = Math.round((total / 1.21) * 100) / 100;
  const vat21Amount = Math.round((total - netTaxedAmount) * 100) / 100;
  return { netTaxedAmount, vat21Amount };
}

export function invoiceTypeToTipoComprobante(type: InvoiceType | null): string {
  switch (type) {
    case "factura_a":
      return "A";
    case "factura_b":
      return "B";
    case "factura_c":
      return "C";
    default:
      return "otro";
  }
}

export type VatComputableValidation = {
  ok: boolean;
  reasons: string[];
};

/** Reglas server-side para marcar IVA computable. */
export function validateVatComputable(input: {
  isVatComputable: boolean;
  invoiceType: InvoiceType | null;
  supplierCuit: string;
  posNumber: string;
  invoiceNumber: string;
  issuedToCompany: boolean | null;
  netTaxedAmount: number;
  vat21Amount: number;
  vat105Amount: number;
  vat27Amount: number;
}): VatComputableValidation {
  if (!input.isVatComputable) {
    return { ok: true, reasons: [] };
  }

  const reasons: string[] = [];

  if (!isVatComputableInvoiceType(input.invoiceType)) {
    reasons.push("Solo Factura A (o equivalente fiscal) puede computar IVA.");
  }
  if (!normalizeCuitDigits(input.supplierCuit)) {
    reasons.push("Falta CUIT del proveedor.");
  }
  if (!String(input.posNumber ?? "").trim()) {
    reasons.push("Falta punto de venta.");
  }
  if (!String(input.invoiceNumber ?? "").trim()) {
    reasons.push("Falta número de comprobante.");
  }
  if (input.issuedToCompany !== true) {
    reasons.push("El comprobante debe estar emitido a nombre de NOTIFICAS SRL.");
  }

  const vatTotal = totalVatAmount(input);
  if (!(input.netTaxedAmount > 0) && !(vatTotal > 0)) {
    reasons.push("Falta discriminar neto gravado e IVA.");
  }

  return { ok: reasons.length === 0, reasons };
}

export function computePagoAlerts(input: {
  isVatComputable: boolean;
  invoiceType: InvoiceType | null;
  supplierCuit: string;
  posNumber: string;
  invoiceNumber: string;
  issuedToCompany: boolean | null;
  netTaxedAmount: number;
  vat21Amount: number;
  vat105Amount: number;
  vat27Amount: number;
  paidBy: PaidBy | null;
  receiverCuitDetected?: string | null;
}): PagoAlert[] {
  const alerts: PagoAlert[] = [];

  if (!input.isVatComputable) {
    alerts.push({
      level: "info",
      message: "Este gasto no será incluido en IVA Compras porque no tiene IVA computable.",
    });
  }

  if (isVatComputableInvoiceType(input.invoiceType)) {
    const vatTotal = totalVatAmount(input);
    if (!(input.netTaxedAmount > 0) || !(vatTotal > 0)) {
      alerts.push({
        level: "warning",
        message: "Este gasto tiene Factura A pero falta discriminar IVA.",
      });
    }
  }

  if (
    input.paidBy === "tarjeta_personal_socio" ||
    input.paidBy === "efectivo_socio"
  ) {
    if (input.isVatComputable && input.issuedToCompany === true) {
      alerts.push({
        level: "warning",
        message:
          "Puede computarse, pero debe registrarse deuda/reintegro al socio (cuenta corriente / aporte pendiente).",
      });
    } else {
      alerts.push({
        level: "info",
        message: "Este gasto fue pagado por socio; revisar reintegro o cuenta particular.",
      });
    }
  }

  if (input.issuedToCompany === false) {
    alerts.push({
      level: "error",
      message: "Este comprobante no parece emitido a nombre de NOTIFICAS SRL.",
    });
  } else if (
    input.receiverCuitDetected &&
    !cuitsMatch(input.receiverCuitDetected, NOTIFICAS_CUIT) &&
    input.invoiceType != null &&
    input.invoiceType !== "sin_comprobante"
  ) {
    alerts.push({
      level: "warning",
      message: "Este comprobante no parece emitido a nombre de NOTIFICAS SRL.",
    });
  }

  const vatCheck = validateVatComputable({
    isVatComputable: input.isVatComputable,
    invoiceType: input.invoiceType,
    supplierCuit: input.supplierCuit,
    posNumber: input.posNumber,
    invoiceNumber: input.invoiceNumber,
    issuedToCompany: input.issuedToCompany,
    netTaxedAmount: input.netTaxedAmount,
    vat21Amount: input.vat21Amount,
    vat105Amount: input.vat105Amount,
    vat27Amount: input.vat27Amount,
  });

  if (input.isVatComputable && !vatCheck.ok) {
    for (const r of vatCheck.reasons) {
      if (!alerts.some((a) => a.message.includes(r))) {
        alerts.push({ level: "error", message: r });
      }
    }
  }

  return alerts;
}

/** Valores por defecto para gastos legacy sin campos fiscales. */
export function defaultFiscalFromLegacy(data: {
  fecha?: string | null;
  importe?: number | null;
  concepto?: string | null;
  proveedor?: string | null;
  medio?: string | null;
  observaciones?: string | null;
  facturaId?: string | null;
  pdfStoragePath?: string | null;
}): PagoFiscalCore {
  const paymentDate = data.fecha ?? "";
  const totalAmount = Number(data.importe) || 0;
  const supplierName = String(data.proveedor ?? "").trim();
  return {
    invoiceType: null,
    posNumber: "",
    invoiceNumber: "",
    supplierCuit: "",
    supplierName,
    supplierVatCondition: null,
    invoiceDate: null,
    paymentDate,
    totalAmount,
    netTaxedAmount: 0,
    vat21Amount: 0,
    vat105Amount: 0,
    vat27Amount: 0,
    exemptAmount: 0,
    vatPerceptionAmount: 0,
    grossIncomePerceptionAmount: 0,
    otherTaxesAmount: 0,
    accountingCategory: null,
    paymentMethod: data.medio ?? null,
    paidBy: null,
    isVatComputable: false,
    isIncomeTaxDeductible: false,
    issuedToCompany: null,
    pdfStoragePath: data.pdfStoragePath ?? null,
    notes: String(data.observaciones ?? "").trim(),
  };
}

export type PagoExportCandidate = {
  id: string;
  invoiceDate: string;
  paymentDate: string;
  invoiceType: InvoiceType | null;
  posNumber: string;
  invoiceNumber: string;
  supplierCuit: string;
  supplierName: string;
  isVatComputable: boolean;
  issuedToCompany: boolean | null;
  totalAmount: number;
  netTaxedAmount: number;
  vat21Amount: number;
  vat105Amount: number;
  vat27Amount: number;
  vatPerceptionAmount: number;
  grossIncomePerceptionAmount: number;
  otherTaxesAmount: number;
  exemptAmount: number;
};

/** Determina si un pago entra al Libro IVA Compras. */
export function isPagoExportableToIvaCompras(p: PagoExportCandidate): boolean {
  if (!p.isVatComputable || p.issuedToCompany !== true) return false;
  return (
    isVatComputableInvoiceType(p.invoiceType) &&
    Boolean(normalizeCuitDigits(p.supplierCuit)) &&
    Boolean(String(p.posNumber).trim()) &&
    Boolean(String(p.invoiceNumber).trim()) &&
    totalVatAmount(p) > 0 &&
    p.netTaxedAmount > 0
  );
}
