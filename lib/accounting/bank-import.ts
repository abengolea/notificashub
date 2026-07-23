import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { ACCOUNTING_COLLECTIONS } from "@/lib/accounting/constants";
import { dateOnlyToUtcMidday } from "@/lib/accounting/dates";
import type { NormalizedBankMovement } from "@/lib/accounting/bank-extract";

export type BankMovementPreviewRow = NormalizedBankMovement & {
  duplicate: boolean;
  existingKind?: "cobro" | "pago";
  existingId?: string;
};

async function findByBankReference(
  bankReference: string
): Promise<{ kind: "cobro" | "pago"; id: string } | null> {
  const [cob, pag] = await Promise.all([
    db
      .collection(ACCOUNTING_COLLECTIONS.cobros)
      .where("bankReference", "==", bankReference)
      .limit(1)
      .get(),
    db
      .collection(ACCOUNTING_COLLECTIONS.pagos)
      .where("bankReference", "==", bankReference)
      .limit(1)
      .get(),
  ]);
  if (!cob.empty) return { kind: "cobro", id: cob.docs[0]!.id };
  if (!pag.empty) return { kind: "pago", id: pag.docs[0]!.id };
  return null;
}

export async function enrichWithDuplicateFlags(
  movements: NormalizedBankMovement[]
): Promise<BankMovementPreviewRow[]> {
  const out: BankMovementPreviewRow[] = [];
  for (const m of movements) {
    const existing = await findByBankReference(m.bankReference);
    out.push({
      ...m,
      duplicate: existing != null,
      existingKind: existing?.kind,
      existingId: existing?.id,
    });
  }
  return out;
}

function pdfObservacionesNote(storagePath: string): string {
  const bucket =
    process.env.FIREBASE_STORAGE_BUCKET?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() ||
    "studio-3864746689-59018.appspot.com";
  return `PDF extracto: gs://${bucket}/${storagePath}`;
}

export async function persistBankMovements(params: {
  movements: NormalizedBankMovement[];
  pdfStoragePath?: string;
}): Promise<{
  importedCobros: number;
  importedPagos: number;
  skippedDuplicates: number;
  errors: string[];
}> {
  let importedCobros = 0;
  let importedPagos = 0;
  let skippedDuplicates = 0;
  const errors: string[] = [];

  for (const m of params.movements) {
    try {
      const existing = await findByBankReference(m.bankReference);
      if (existing) {
        skippedDuplicates += 1;
        continue;
      }

      const obsParts = [m.observaciones?.trim(), params.pdfStoragePath ? pdfObservacionesNote(params.pdfStoragePath) : ""]
        .filter(Boolean)
        .join("\n");

      const base = {
        empresa: "notificas_srl",
        fecha: Timestamp.fromDate(dateOnlyToUtcMidday(m.fecha)),
        importe: m.importe,
        concepto: m.concepto,
        medio: m.medio,
        facturaId: null,
        bankReference: m.bankReference,
        bankReferencia: m.referenciaBanco,
        observaciones: obsParts.length > 0 ? obsParts : null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (m.kind === "cobro") {
        await db.collection(ACCOUNTING_COLLECTIONS.cobros).add(base);
        importedCobros += 1;
      } else {
        const vep = m.vepHint;
        await db.collection(ACCOUNTING_COLLECTIONS.pagos).add({
          ...base,
          proveedor: vep ? "AFIP - ARCA" : null,
          invoiceType: vep ? "vep" : null,
          accountingCategory: vep ? "impuestos" : null,
          taxSubcategory: vep?.taxSubcategory ?? null,
          isVatComputable: false,
          isIncomeTaxDeductible: vep?.isIncomeTaxDeductible ?? false,
          issuedToCompany: null,
          netTaxedAmount: 0,
          vat21Amount: 0,
          vat105Amount: 0,
          vat27Amount: 0,
          totalAmount: base.importe,
        });
        importedPagos += 1;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${m.bankReference}: ${msg}`);
    }
  }

  return { importedCobros, importedPagos, skippedDuplicates, errors };
}
