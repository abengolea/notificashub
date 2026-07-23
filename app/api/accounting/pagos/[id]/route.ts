import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { requireDashboard } from "@/lib/require-dashboard";
import { resolveAccountingEntity } from "@/lib/accounting/constants";
import { dateOnlyToUtcMidday } from "@/lib/accounting/dates";
import { pagoBodySchema } from "@/lib/accounting/schemas";
import { pagoBodyToFirestore, pagoFirestoreWithTimestamps } from "@/lib/accounting/pago-persist";

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

  const entity = resolveAccountingEntity(
    new URL(req.url).searchParams,
    (body as { entity?: unknown }).entity
  );

  const parsed = pagoBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validación fallida", details: parsed.error.flatten() }, { status: 400 });
  }

  const row = parsed.data;
  const ref = db.collection(entity.collections.pagos).doc(id);

  try {
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

    const fsRow = pagoBodyToFirestore(row);
    const paymentDate = row.paymentDate ?? row.fecha;
    const paymentTs = Timestamp.fromDate(dateOnlyToUtcMidday(paymentDate));
    const doc = pagoFirestoreWithTimestamps(fsRow, paymentTs);

    await ref.update({
      ...doc,
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

  const entity = resolveAccountingEntity(new URL(req.url).searchParams);

  try {
    await db.collection(entity.collections.pagos).doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[accounting/pagos DELETE]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
