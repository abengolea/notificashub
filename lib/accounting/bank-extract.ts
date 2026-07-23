import { medioPagoSchema } from "@/lib/accounting/schemas";
import type { MedioPago, TaxSubcategory } from "@/lib/accounting/schemas";
import { TAX_SUBCATEGORY_DEDUCTIBLE } from "@/lib/accounting/pago-fiscal";

export type BankMovementKind = "cobro" | "pago" | "ignorar";

export type RawBankMovement = {
  fecha: string;
  importe: number;
  concepto: string;
  referenciaBanco?: string;
  saldo?: number;
  clasificacion?: string;
};

export type VepHint = {
  isVep: true;
  taxSubcategory: TaxSubcategory;
  isIncomeTaxDeductible: boolean;
};

export type NormalizedBankMovement = {
  fecha: string;
  importe: number;
  concepto: string;
  kind: Exclude<BankMovementKind, "ignorar">;
  medio: MedioPago;
  bankReference: string;
  referenciaBanco: string;
  observaciones?: string;
  vepHint?: VepHint;
};

const PAGO_KEYWORDS = /\b(DBCR|DEBITO|DÉBITO|COMISION|COMISIÓN|TASA\s+GRAL|IMPUESTO|IVA\s+DB|GASTO|COM\.|MANTENIMIENTO)\b/i;
const COBRO_KEYWORDS = /\b(CCERR|CREDITO|CRÉDITO|TRANSF|TRANSFERENCIA|DEPOSITO|DEPÓSITO|COBRO|INGRESO|ABONO)\b/i;

const VEP_PATTERNS: { pattern: RegExp; taxSubcategory: TaxSubcategory }[] = [
  { pattern: /\bVEP\b.*\bIVA\b|\bIVA\b.*\bVEP\b|PAGO\s+IVA/i, taxSubcategory: "iva" },
  { pattern: /\bVEP\b.*\bIIBB\b|\bIIBB\b.*\bVEP\b|INGRESOS\s+BRUTOS|ING\.?\s*BRUT/i, taxSubcategory: "iibb" },
  { pattern: /\bVEP\b.*\bGANANCI|\bGANANCI.*\bVEP\b|IMPUESTO\s+GANANCIAS/i, taxSubcategory: "ganancias" },
  { pattern: /BIENES\s+PERSONALES|BIEN\.?\s*PERS/i, taxSubcategory: "bienes_personales" },
  { pattern: /\bAUTONOMO|\bAUTÓNOMO/i, taxSubcategory: "autonomos" },
  { pattern: /SELLO|IMPUESTO\s+SELLO/i, taxSubcategory: "sellos" },
  { pattern: /\bVEP\b|\bAFIP\b|\bARCA\b|\bARBA\b|\bDGR\b|\bAGIP\b/i, taxSubcategory: "otro_tributo" },
];

export function inferVepHint(concepto: string): VepHint | undefined {
  for (const { pattern, taxSubcategory } of VEP_PATTERNS) {
    if (pattern.test(concepto)) {
      return {
        isVep: true,
        taxSubcategory,
        isIncomeTaxDeductible: TAX_SUBCATEGORY_DEDUCTIBLE[taxSubcategory],
      };
    }
  }
  return undefined;
}

export function defaultBankAccountId(): string {
  const fromEnv = process.env.ACCOUNTING_BANK_ACCOUNT_NUMBER?.trim();
  if (fromEnv) return fromEnv.replace(/\s/g, "");
  return "385209425144719";
}

/** Idempotencia: cuenta + fecha + ref banco + importe con signo (centavos). */
export function buildBankReference(params: {
  cuentaNumero: string;
  fecha: string;
  referenciaBanco: string;
  importeSigned: number;
}): string {
  const cuenta = params.cuentaNumero.replace(/\s/g, "") || "default";
  const ref = (params.referenciaBanco || "sin-ref").replace(/\s/g, "").slice(0, 32);
  const cents = Math.round(params.importeSigned * 100);
  return `bank_${cuenta}_${params.fecha}_${ref}_${cents}`;
}

export function parseFechaYmd(input: string): string | null {
  const s = String(input ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(s);
  if (dmy) {
    const dd = dmy[1].padStart(2, "0");
    const mm = dmy[2].padStart(2, "0");
    return `${dmy[3]}-${mm}-${dd}`;
  }
  return null;
}

function coerceMedio(v: unknown): MedioPago {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  const parsed = medioPagoSchema.safeParse(s || "transferencia");
  return parsed.success ? parsed.data : "transferencia";
}

export function inferKindFromImporteAndConcepto(
  importeSigned: number,
  concepto: string,
  clasificacionAi?: string
): BankMovementKind {
  const cls = String(clasificacionAi ?? "")
    .trim()
    .toLowerCase();
  if (cls === "ignorar" || cls === "ignore") return "ignorar";
  if (cls === "cobro") return "cobro";
  if (cls === "pago") return "pago";

  const concept = concepto.trim();
  if (PAGO_KEYWORDS.test(concept) && importeSigned <= 0) return "pago";
  if (COBRO_KEYWORDS.test(concept) && importeSigned >= 0) return "cobro";

  if (importeSigned > 0) return "cobro";
  if (importeSigned < 0) return "pago";
  return "ignorar";
}

export function normalizeBankMovement(
  raw: RawBankMovement,
  cuentaNumero: string
): NormalizedBankMovement | null {
  const fecha = parseFechaYmd(raw.fecha);
  if (!fecha) return null;

  const importeSigned = Number(raw.importe);
  if (!Number.isFinite(importeSigned) || importeSigned === 0) return null;

  const concepto = String(raw.concepto ?? "").trim().slice(0, 512);
  if (!concepto) return null;

  const kind = inferKindFromImporteAndConcepto(importeSigned, concepto, raw.clasificacion);
  if (kind === "ignorar") return null;

  const referenciaBanco = String(raw.referenciaBanco ?? "").trim().slice(0, 64) || "sin-ref";
  const importe = Math.abs(importeSigned);
  const bankReference = buildBankReference({
    cuentaNumero,
    fecha,
    referenciaBanco,
    importeSigned,
  });

  const saldo =
    raw.saldo != null && Number.isFinite(Number(raw.saldo)) ? Number(raw.saldo) : undefined;
  const observaciones =
    saldo != null
      ? `Extracto bancario · ref ${referenciaBanco} · saldo ${saldo.toLocaleString("es-AR")}`
      : `Extracto bancario · ref ${referenciaBanco}`;

  const vepHint = kind === "pago" ? inferVepHint(concepto) : undefined;

  return {
    fecha,
    importe,
    concepto,
    kind,
    medio: coerceMedio("transferencia"),
    bankReference,
    referenciaBanco,
    observaciones,
    ...(vepHint ? { vepHint } : {}),
  };
}

export function normalizeBankExtractRows(
  rows: RawBankMovement[],
  cuentaNumero: string
): NormalizedBankMovement[] {
  const out: NormalizedBankMovement[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const n = normalizeBankMovement(row, cuentaNumero);
    if (!n || seen.has(n.bankReference)) continue;
    seen.add(n.bankReference);
    out.push(n);
  }
  return out;
}
