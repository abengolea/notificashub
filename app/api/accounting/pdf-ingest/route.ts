import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { ACCOUNTING_COLLECTIONS } from "@/lib/accounting/constants";
import { dateOnlyToUtcMidday } from "@/lib/accounting/dates";
import { extractFacturaFromPdf, extractPagoFiscalFromPdf } from "@/lib/accounting/pdf-ai-extract";
import { facturaBodySchema, pagoBodySchema } from "@/lib/accounting/schemas";
import { uploadAccountingPdf } from "@/lib/accounting/storage-pdf";
import { requireDashboard } from "@/lib/require-dashboard";

export const runtime = "nodejs";

const MAX_BYTES = 12 * 1024 * 1024;

const DEFAULT_PROJECT_ID = "studio-3864746689-59018";

function pdfObservacionesNote(storagePath: string): string {
  const bucket =
    process.env.FIREBASE_STORAGE_BUCKET?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() ||
    `${DEFAULT_PROJECT_ID}.appspot.com`;
  return `PDF: gs://${bucket}/${storagePath}`;
}

export async function POST(req: NextRequest) {
  const denied = await requireDashboard(req);
  if (denied) return denied;

  if (!process.env.GOOGLE_AI_API_KEY?.trim()) {
    return NextResponse.json(
      { error: "GOOGLE_AI_API_KEY no configurada en el servidor." },
      { status: 503 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "FormData inválido" }, { status: 400 });
  }

  const tipo = String(form.get("tipo") ?? "").trim().toLowerCase();
  if (tipo !== "factura" && tipo !== "pago") {
    return NextResponse.json({ error: 'Campo "tipo" debe ser factura o pago' }, { status: 400 });
  }

  const tipoLibroRaw = String(form.get("tipoLibro") ?? "venta").trim().toLowerCase();
  const tipoLibro = tipoLibroRaw === "compra" ? "compra" : "venta";

  const autoSaveRaw = String(form.get("autoSave") ?? "true").trim().toLowerCase();
  const autoSave = autoSaveRaw !== "false" && autoSaveRaw !== "0";

  const file = form.get("pdf");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'Falta archivo "pdf"' }, { status: 400 });
  }

  const mime = (file.type || "").toLowerCase();
  const nameLower = "name" in file && typeof file.name === "string" ? file.name.toLowerCase() : "";
  if (mime !== "application/pdf" && !nameLower.endsWith(".pdf")) {
    return NextResponse.json({ error: "Solo se aceptan archivos PDF." }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length === 0 || buf.length > MAX_BYTES) {
    return NextResponse.json(
      { error: `El PDF debe tener entre 1 y ${MAX_BYTES / (1024 * 1024)} MB.` },
      { status: 400 }
    );
  }

  const originalName =
    "name" in file && typeof file.name === "string" && file.name.trim().length > 0
      ? file.name.trim()
      : "documento.pdf";

  let storagePath = "";
  try {
    const up = await uploadAccountingPdf({ buffer: buf, originalName });
    storagePath = up.storagePath;
  } catch (e) {
    console.error("[accounting/pdf-ingest] Storage:", e);
    return NextResponse.json({ error: "No se pudo subir el PDF a Storage." }, { status: 500 });
  }

  const pdfBase64 = buf.toString("base64");

  try {
    if (tipo === "factura") {
      const extracted = await extractFacturaFromPdf({
        pdfBase64,
        filename: originalName,
        tipoLibro,
      });

      const parsed = facturaBodySchema.safeParse({
        tipo: extracted.tipo,
        numero: extracted.numero,
        puntoVenta: extracted.puntoVenta,
        fecha: extracted.fecha,
        razonsocial: extracted.razonsocial,
        cuit: extracted.cuit,
        tipoComprobante: extracted.tipoComprobante,
        netoGravado: extracted.netoGravado,
        iva: extracted.iva,
        otrosImpuestos: extracted.otrosImpuestos,
        total: extracted.total,
        observaciones: extracted.observaciones,
      });

      if (!parsed.success) {
        return NextResponse.json(
          {
            error: "La IA extrajo datos que no pasan validación",
            pdfStoragePath: storagePath,
            details: parsed.error.flatten(),
          },
          { status: 422 }
        );
      }

      const b = parsed.data;
      const fechaTs = Timestamp.fromDate(dateOnlyToUtcMidday(b.fecha));
      const observacionesMerged = [b.observaciones?.trim(), pdfObservacionesNote(storagePath)]
        .filter(Boolean)
        .join("\n");

      const ref = await db.collection(ACCOUNTING_COLLECTIONS.facturas).add({
        empresa: "notificas_srl",
        tipo: b.tipo,
        numero: b.numero,
        puntoVenta: b.puntoVenta ?? null,
        fecha: fechaTs,
        razonsocial: b.razonsocial,
        cuit: b.cuit ?? null,
        tipoComprobante: b.tipoComprobante ?? null,
        netoGravado: b.netoGravado,
        iva: b.iva,
        otrosImpuestos: b.otrosImpuestos ?? 0,
        total: b.total,
        observaciones: observacionesMerged.length > 0 ? observacionesMerged : null,
        pdfStoragePath: storagePath,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      return NextResponse.json({
        kind: "factura",
        id: ref.id,
        pdfStoragePath: storagePath,
        extracted: b,
      });
    }

    const extracted = await extractPagoFiscalFromPdf({
      pdfBase64,
      filename: originalName,
    });

    const paymentDate = extracted.paymentDate ?? extracted.fecha;
    const observacionesMerged = [extracted.observaciones?.trim(), pdfObservacionesNote(storagePath)]
      .filter(Boolean)
      .join("\n");

    const draftBody = {
      fecha: paymentDate,
      importe: extracted.totalAmount || extracted.importe,
      concepto: extracted.concepto,
      proveedor: extracted.proveedor ?? extracted.supplierName,
      medio: extracted.medio,
      observaciones: observacionesMerged || undefined,
      invoiceType: extracted.invoiceType ?? null,
      posNumber: extracted.posNumber,
      invoiceNumber: extracted.invoiceNumber,
      supplierCuit: extracted.supplierCuit,
      supplierName: extracted.supplierName ?? extracted.proveedor,
      supplierVatCondition: extracted.supplierVatCondition ?? null,
      invoiceDate: extracted.invoiceDate ?? null,
      paymentDate,
      totalAmount: extracted.totalAmount || extracted.importe,
      netTaxedAmount: extracted.netTaxedAmount,
      vat21Amount: extracted.vat21Amount,
      vat105Amount: extracted.vat105Amount,
      vat27Amount: extracted.vat27Amount,
      exemptAmount: extracted.exemptAmount,
      vatPerceptionAmount: extracted.vatPerceptionAmount,
      grossIncomePerceptionAmount: extracted.grossIncomePerceptionAmount,
      otherTaxesAmount: extracted.otherTaxesAmount,
      paymentMethod: extracted.medio,
      isVatComputable: extracted.isVatComputable,
      isIncomeTaxDeductible: false,
      issuedToCompany: extracted.issuedToCompany,
      pdfStoragePath: storagePath,
      notes: observacionesMerged || undefined,
    };

    if (!autoSave) {
      return NextResponse.json({
        kind: "pago_preview",
        pdfStoragePath: storagePath,
        extracted: draftBody,
        receiverCuit: extracted.receiverCuit,
        receiverName: extracted.receiverName,
      });
    }

    const parsed = pagoBodySchema.safeParse(draftBody);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "La IA extrajo datos que no pasan validación",
          pdfStoragePath: storagePath,
          extracted: draftBody,
          details: parsed.error.flatten(),
        },
        { status: 422 }
      );
    }

    const row = parsed.data;

    const ref = await db.collection(ACCOUNTING_COLLECTIONS.pagos).add({
      empresa: "notificas_srl",
      fecha: Timestamp.fromDate(dateOnlyToUtcMidday(row.paymentDate ?? row.fecha)),
      importe: row.totalAmount ?? row.importe,
      concepto: row.concepto,
      medio: row.paymentMethod ?? row.medio ?? null,
      proveedor: row.supplierName ?? row.proveedor ?? null,
      facturaId: null,
      observaciones: row.notes ?? row.observaciones ?? null,
      invoiceType: row.invoiceType ?? null,
      posNumber: row.posNumber ?? null,
      invoiceNumber: row.invoiceNumber ?? null,
      supplierCuit: row.supplierCuit ?? null,
      supplierName: row.supplierName ?? row.proveedor ?? null,
      supplierVatCondition: row.supplierVatCondition ?? null,
      invoiceDate: row.invoiceDate
        ? Timestamp.fromDate(dateOnlyToUtcMidday(row.invoiceDate))
        : null,
      paymentDate: Timestamp.fromDate(dateOnlyToUtcMidday(row.paymentDate ?? row.fecha)),
      totalAmount: row.totalAmount ?? row.importe,
      netTaxedAmount: row.netTaxedAmount ?? 0,
      vat21Amount: row.vat21Amount ?? 0,
      vat105Amount: row.vat105Amount ?? 0,
      vat27Amount: row.vat27Amount ?? 0,
      exemptAmount: row.exemptAmount ?? 0,
      vatPerceptionAmount: row.vatPerceptionAmount ?? 0,
      grossIncomePerceptionAmount: row.grossIncomePerceptionAmount ?? 0,
      otherTaxesAmount: row.otherTaxesAmount ?? 0,
      paymentMethod: row.paymentMethod ?? row.medio ?? null,
      paidBy: row.paidBy ?? null,
      isVatComputable: row.isVatComputable === true,
      isIncomeTaxDeductible: row.isIncomeTaxDeductible === true,
      issuedToCompany: row.issuedToCompany ?? null,
      pdfStoragePath: storagePath,
      notes: row.notes ?? row.observaciones ?? null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      kind: "pago",
      id: ref.id,
      pdfStoragePath: storagePath,
      extracted: row,
    });
  } catch (e) {
    console.error("[accounting/pdf-ingest]", e);
    const msg = e instanceof Error ? e.message : "Error procesando PDF";
    return NextResponse.json(
      { error: msg, pdfStoragePath: storagePath },
      { status: 502 }
    );
  }
}
