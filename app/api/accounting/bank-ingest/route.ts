import { NextRequest, NextResponse } from "next/server";
import { defaultBankAccountId, normalizeBankExtractRows } from "@/lib/accounting/bank-extract";
import { enrichWithDuplicateFlags } from "@/lib/accounting/bank-import";
import { resolveAccountingEntity } from "@/lib/accounting/constants";
import { extractBankExtractFromPdf } from "@/lib/accounting/pdf-ai-extract";
import { uploadAccountingPdf } from "@/lib/accounting/storage-pdf";
import { requireDashboard } from "@/lib/require-dashboard";

export const runtime = "nodejs";

const MAX_BYTES = 12 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const denied = await requireDashboard(req);
  if (denied) return denied;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "FormData inválido" }, { status: 400 });
  }

  const entity = resolveAccountingEntity(
    new URL(req.url).searchParams,
    form.get("entity")
  );
  if (!entity.integrations.bankIngest) {
    return NextResponse.json(
      { error: "Importación bancaria solo disponible para Notificas SRL" },
      { status: 400 }
    );
  }

  if (!process.env.GOOGLE_AI_API_KEY?.trim()) {
    return NextResponse.json(
      { error: "GOOGLE_AI_API_KEY no configurada en el servidor." },
      { status: 503 }
    );
  }

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
      : "extracto-banco.pdf";

  let storagePath = "";
  try {
    const up = await uploadAccountingPdf({ buffer: buf, originalName });
    storagePath = up.storagePath;
  } catch (e) {
    console.error("[accounting/bank-ingest] Storage:", e);
    return NextResponse.json({ error: "No se pudo subir el PDF a Storage." }, { status: 500 });
  }

  try {
    const extracted = await extractBankExtractFromPdf({
      pdfBase64: buf.toString("base64"),
      filename: originalName,
    });

    const cuentaNumero =
      extracted.cuentaNumero.replace(/\s/g, "") || defaultBankAccountId();
    const normalized = normalizeBankExtractRows(extracted.movimientos, cuentaNumero);

    if (normalized.length === 0) {
      return NextResponse.json(
        {
          error: "No se detectaron movimientos válidos en el extracto.",
          pdfStoragePath: storagePath,
          rawCount: extracted.movimientos.length,
        },
        { status: 422 }
      );
    }

    const preview = await enrichWithDuplicateFlags(normalized);

    return NextResponse.json({
      ok: true,
      pdfStoragePath: storagePath,
      cuentaNumero,
      moneda: extracted.moneda,
      movimientos: preview.map((m) => ({
        bankReference: m.bankReference,
        kind: m.kind,
        fecha: m.fecha,
        importe: m.importe,
        concepto: m.concepto,
        medio: m.medio,
        referenciaBanco: m.referenciaBanco,
        observaciones: m.observaciones ?? "",
        duplicate: m.duplicate,
        existingKind: m.existingKind,
        existingId: m.existingId,
        selected: !m.duplicate,
        vepHint: m.vepHint ?? null,
      })),
    });
  } catch (e) {
    console.error("[accounting/bank-ingest]", e);
    const msg = e instanceof Error ? e.message : "Error procesando extracto";
    return NextResponse.json({ error: msg, pdfStoragePath: storagePath }, { status: 502 });
  }
}
