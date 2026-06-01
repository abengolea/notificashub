import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { requireDashboard } from "@/lib/require-dashboard";
import { ACCOUNTING_COLLECTIONS } from "@/lib/accounting/constants";
import { dateOnlyToUtcMidday } from "@/lib/accounting/dates";
import { extractPagoFiscalFromPdf } from "@/lib/accounting/pdf-ai-extract";
import { resolvePagoForIvaExport, inferLegacyFiscalFields } from "@/lib/accounting/pago-legacy-infer";
import { pagoDocToRecord, pagoFirestoreWithTimestamps, pagoBodyToFirestore } from "@/lib/accounting/pago-persist";
import { downloadAccountingPdf } from "@/lib/accounting/storage-pdf";
import { auditPagoItem } from "@/lib/accounting/iva-audit";

type RepairBody = {
  pagoId?: string;
  year?: number;
  month?: number;
  /** Aplicar inferencia legacy sin re-OCR */
  applyInferred?: boolean;
  /** Re-leer PDF con Gemini y fusionar */
  reprocessPdf?: boolean;
};

function bounds(year: number, month: number): { start: Timestamp; end: Timestamp } {
  const startD = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const endD = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { start: Timestamp.fromDate(startD), end: Timestamp.fromDate(endD) };
}

async function repairOnePago(
  pagoId: string,
  opts: { applyInferred: boolean; reprocessPdf: boolean }
): Promise<{ id: string; ok: boolean; error?: string; audit?: ReturnType<typeof auditPagoItem> }> {
  const ref = db.collection(ACCOUNTING_COLLECTIONS.pagos).doc(pagoId);
  const snap = await ref.get();
  if (!snap.exists) return { id: pagoId, ok: false, error: "No encontrado" };

  let working = pagoDocToRecord(pagoId, snap.data()!);

  if (opts.reprocessPdf && process.env.GOOGLE_AI_API_KEY?.trim()) {
    const pdfPath = working.pdfStoragePath ?? inferLegacyFiscalFields(working).pdfStoragePath;
    if (!pdfPath) {
      return { id: pagoId, ok: false, error: "Sin PDF para re-OCR" };
    }
    try {
      const buf = await downloadAccountingPdf(pdfPath);
      const extracted = await extractPagoFiscalFromPdf({
        pdfBase64: buf.toString("base64"),
        filename: pdfPath.split("/").pop() ?? "factura.pdf",
      });
      working = {
        ...working,
        invoiceType: (extracted.invoiceType as typeof working.invoiceType) ?? working.invoiceType,
        posNumber: extracted.posNumber ?? working.posNumber,
        invoiceNumber: extracted.invoiceNumber ?? working.invoiceNumber,
        supplierCuit: extracted.supplierCuit || working.supplierCuit,
        supplierName: extracted.supplierName ?? working.supplierName,
        invoiceDate: extracted.invoiceDate ?? working.invoiceDate,
        netTaxedAmount: extracted.netTaxedAmount > 0 ? extracted.netTaxedAmount : working.netTaxedAmount,
        vat21Amount: extracted.vat21Amount > 0 ? extracted.vat21Amount : working.vat21Amount,
        vat105Amount: extracted.vat105Amount > 0 ? extracted.vat105Amount : working.vat105Amount,
        vat27Amount: extracted.vat27Amount > 0 ? extracted.vat27Amount : working.vat27Amount,
        isVatComputable: extracted.isVatComputable || working.isVatComputable,
        issuedToCompany: extracted.issuedToCompany ?? working.issuedToCompany,
        pdfStoragePath: pdfPath,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { id: pagoId, ok: false, error: `Error re-OCR PDF: ${msg}` };
    }
  }

  if (!opts.applyInferred && !opts.reprocessPdf) {
    return { id: pagoId, ok: false, error: "Especificá applyInferred o reprocessPdf" };
  }

  const resolved = resolvePagoForIvaExport(working);
  const inf = resolved.legacyInference;
  const needsReview = inf.needsManualReview || opts.reprocessPdf;

  const body = pagoBodyToFirestore({
    fecha: resolved.paymentDate,
    importe: resolved.totalAmount,
    concepto: resolved.concepto,
    proveedor: resolved.supplierName || resolved.proveedor,
    medio: resolved.medio ?? undefined,
    observaciones: resolved.observaciones,
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
    exemptAmount: resolved.exemptAmount,
    vatPerceptionAmount: resolved.vatPerceptionAmount,
    grossIncomePerceptionAmount: resolved.grossIncomePerceptionAmount,
    otherTaxesAmount: resolved.otherTaxesAmount,
    isVatComputable: resolved.isVatComputable,
    issuedToCompany: resolved.issuedToCompany,
    pdfStoragePath: resolved.pdfStoragePath,
    notes: resolved.notes || resolved.observaciones,
  });

  const paymentTs = Timestamp.fromDate(dateOnlyToUtcMidday(resolved.paymentDate));
  const doc = pagoFirestoreWithTimestamps(body, paymentTs);

  await ref.update({
    ...doc,
    needsFiscalReview: needsReview,
    fiscalInferredAt: FieldValue.serverTimestamp(),
    fiscalInferredFields: inf.inferredFields,
    updatedAt: FieldValue.serverTimestamp(),
  });

  const year = parseInt(resolved.paymentDate.slice(0, 4), 10) || new Date().getFullYear();
  const month = parseInt(resolved.paymentDate.slice(5, 7), 10) || 1;
  const updatedSnap = await ref.get();
  const audit = auditPagoItem({ id: pagoId, data: () => updatedSnap.data()! }, year, month);

  return { id: pagoId, ok: true, audit };
}

/** POST /api/accounting/iva-audit/repair — persiste inferencia legacy o re-OCR PDF. */
export async function POST(req: NextRequest) {
  const denied = await requireDashboard(req);
  if (denied) return denied;

  let body: RepairBody;
  try {
    body = (await req.json()) as RepairBody;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const applyInferred = body.applyInferred === true;
  const reprocessPdf = body.reprocessPdf === true;

  try {
    if (body.pagoId) {
      const result = await repairOnePago(body.pagoId, { applyInferred, reprocessPdf });
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.error === "No encontrado" ? 404 : 422 });
      }
      return NextResponse.json({ repaired: [result] });
    }

    const y = body.year;
    const m = body.month;
    if (!Number.isFinite(y) || !Number.isFinite(m) || m! < 1 || m! > 12) {
      return NextResponse.json({ error: "Para reparación masiva: year y month requeridos" }, { status: 400 });
    }

    const { start, end } = bounds(y!, m!);
    const snap = await db
      .collection(ACCOUNTING_COLLECTIONS.pagos)
      .where("fecha", ">=", start)
      .where("fecha", "<=", end)
      .limit(500)
      .get();

    const results = [];
    for (const doc of snap.docs) {
      const raw = pagoDocToRecord(doc.id, doc.data());
      const needsRepair =
        !raw.isVatComputable ||
        !raw.invoiceType ||
        raw.netTaxedAmount <= 0 ||
        !raw.supplierCuit ||
        !raw.posNumber ||
        !raw.invoiceNumber;

      if (!needsRepair) continue;

      const r = await repairOnePago(doc.id, {
        applyInferred,
        reprocessPdf: reprocessPdf && Boolean(raw.pdfStoragePath),
      });
      results.push(r);
    }

    return NextResponse.json({ repaired: results, total: results.length });
  } catch (e) {
    console.error("[accounting/iva-audit/repair POST]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
