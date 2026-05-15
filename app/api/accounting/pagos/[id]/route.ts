import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { requireDashboard } from "@/lib/require-dashboard";
import { ACCOUNTING_COLLECTIONS } from "@/lib/accounting/constants";
import { dateOnlyToUtcMidday } from "@/lib/accounting/dates";
import { pagoBodySchema } from "@/lib/accounting/schemas";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const denied = await requireDashboard(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = pagoBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validación fallida", details: parsed.error.flatten() }, { status: 400 });
  }

  const row = parsed.data;
  const ref = db.collection(ACCOUNTING_COLLECTIONS.pagos).doc(id);

  try {
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

    await ref.update({
      fecha: Timestamp.fromDate(dateOnlyToUtcMidday(row.fecha)),
      importe: row.importe,
      concepto: row.concepto,
      medio: row.medio ?? null,
      proveedor: row.proveedor ?? null,
      facturaId: row.facturaId ?? null,
      observaciones: row.observaciones ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[accounting/pagos PATCH]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const denied = await requireDashboard(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });

  try {
    await db.collection(ACCOUNTING_COLLECTIONS.pagos).doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[accounting/pagos DELETE]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
