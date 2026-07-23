import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { requireDashboard } from "@/lib/require-dashboard";
import { resolveAccountingEntity } from "@/lib/accounting/constants";
import { bienBodySchema } from "@/lib/accounting/schemas";
import { loadBienesPersonalesYear } from "@/lib/bienes-personales/period-export";

export async function GET(req: NextRequest) {
  const denied = await requireDashboard(req);
  if (denied) return denied;

  const searchParams = new URL(req.url).searchParams;
  const entity = resolveAccountingEntity(searchParams);
  const y = parseInt(searchParams.get("year") ?? "", 10);
  if (!Number.isFinite(y)) {
    return NextResponse.json({ error: "Query year requerido" }, { status: 400 });
  }

  try {
    const data = await loadBienesPersonalesYear({ year: y, entityId: entity.id });
    return NextResponse.json(data);
  } catch (e) {
    console.error("[accounting/bienes GET]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireDashboard(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const entity = resolveAccountingEntity(
    new URL(req.url).searchParams,
    (body as { entity?: unknown }).entity
  );

  if (!entity.isIndividual) {
    return NextResponse.json(
      { error: "Bienes Personales solo aplica a entidades individuales" },
      { status: 400 }
    );
  }

  const parsed = bienBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validación fallida", details: parsed.error.flatten() }, { status: 400 });
  }

  const row = parsed.data;
  try {
    const ref = await db.collection(entity.collections.bienes).add({
      empresa: entity.empresa,
      year: row.year,
      naturaleza: row.naturaleza,
      tipo: row.tipo,
      descripcion: row.descripcion,
      valuacionFiscal: row.valuacionFiscal,
      notes: row.notes ?? null,
      pdfStoragePath: row.pdfStoragePath ?? null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (e) {
    console.error("[accounting/bienes POST]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
