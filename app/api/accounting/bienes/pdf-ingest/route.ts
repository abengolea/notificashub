import { NextRequest, NextResponse } from "next/server";
import { resolveAccountingEntity } from "@/lib/accounting/constants";
import { extractBienFromPdf } from "@/lib/accounting/pdf-ai-extract";
import { uploadAccountingPdf } from "@/lib/accounting/storage-pdf";
import { requireDashboard } from "@/lib/require-dashboard";

export const runtime = "nodejs";

const MAX_BYTES = 12 * 1024 * 1024;

/**
 * POST /api/accounting/bienes/pdf-ingest
 * Sube el PDF (título, cédula, resumen de cuenta, etc.), lo analiza con IA y devuelve un
 * borrador para precargar el formulario de "Cargar bien" — no guarda nada en Firestore,
 * el alta se confirma siempre con POST /api/accounting/bienes (revisión humana antes de declarar).
 */
export async function POST(req: NextRequest) {
  const denied = await requireDashboard(req);
  if (denied) return denied;

  if (!process.env.GOOGLE_AI_API_KEY?.trim()) {
    return NextResponse.json({ error: "GOOGLE_AI_API_KEY no configurada en el servidor." }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "FormData inválido" }, { status: 400 });
  }

  const entity = resolveAccountingEntity(new URL(req.url).searchParams, form.get("entity"));
  if (!entity.isIndividual) {
    return NextResponse.json(
      { error: "Bienes Personales solo aplica a entidades individuales" },
      { status: 400 }
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
      : "documento.pdf";

  let storagePath = "";
  try {
    const up = await uploadAccountingPdf({
      buffer: buf,
      originalName,
      storagePrefix: entity.storagePrefix,
    });
    storagePath = up.storagePath;
  } catch (e) {
    console.error("[bienes/pdf-ingest] Storage:", e);
    return NextResponse.json({ error: "No se pudo subir el PDF a Storage." }, { status: 500 });
  }

  try {
    const extracted = await extractBienFromPdf({
      pdfBase64: buf.toString("base64"),
      filename: originalName,
    });

    return NextResponse.json({
      kind: "bien_preview",
      pdfStoragePath: storagePath,
      extracted,
    });
  } catch (e) {
    console.error("[bienes/pdf-ingest]", e);
    const msg = e instanceof Error ? e.message : "Error procesando PDF";
    return NextResponse.json({ error: msg, pdfStoragePath: storagePath }, { status: 502 });
  }
}
