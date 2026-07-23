import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { requireDashboard } from "@/lib/require-dashboard";
import { resolveAccountingEntity } from "@/lib/accounting/constants";
import { dateOnlyToUtcMidday } from "@/lib/accounting/dates";
import { pagoBodySchema } from "@/lib/accounting/schemas";
import { pagoBodyToFirestore, pagoDocToRecord, pagoFirestoreWithTimestamps } from "@/lib/accounting/pago-persist";

function bounds(searchParams: URLSearchParams): { start: Timestamp; end: Timestamp } | null {
  const y = searchParams.get("year");
  const m = searchParams.get("month");
  if (!y || !m) return null;
  const year = parseInt(y, 10);
  const month = parseInt(m, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  const startD = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const endD = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { start: Timestamp.fromDate(startD), end: Timestamp.fromDate(endD) };
}

export async function GET(req: NextRequest) {
  const denied = await requireDashboard(req);
  if (denied) return denied;

  const searchParams = new URL(req.url).searchParams;
  const entity = resolveAccountingEntity(searchParams);
  const col = db.collection(entity.collections.pagos);
  const b = bounds(searchParams);

  try {
    const snap =
      b != null
        ? await col
            .where("fecha", ">=", b.start)
            .where("fecha", "<=", b.end)
            .orderBy("fecha", "desc")
            .limit(500)
            .get()
        : await col.orderBy("fecha", "desc").limit(200).get();

    const items = snap.docs.map((doc) => pagoDocToRecord(doc.id, doc.data()));

    return NextResponse.json({ pagos: items });
  } catch (e) {
    console.error("[accounting/pagos GET]", e);
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

  const parsed = pagoBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validación fallida", details: parsed.error.flatten() }, { status: 400 });
  }

  const row = parsed.data;
  const fsRow = pagoBodyToFirestore(row);
  const paymentDate = row.paymentDate ?? row.fecha;

  try {
    const paymentTs = Timestamp.fromDate(dateOnlyToUtcMidday(paymentDate));
    const doc = pagoFirestoreWithTimestamps(fsRow, paymentTs);

    const ref = await db.collection(entity.collections.pagos).add({
      empresa: entity.empresa,
      ...doc,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (e) {
    console.error("[accounting/pagos POST]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
