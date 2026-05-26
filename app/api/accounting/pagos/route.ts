import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { requireDashboard } from "@/lib/require-dashboard";
import { ACCOUNTING_COLLECTIONS } from "@/lib/accounting/constants";
import { dateOnlyToUtcMidday } from "@/lib/accounting/dates";
import { pagoBodySchema } from "@/lib/accounting/schemas";
import { toIso } from "@/lib/accounting/serialize";

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

  const col = db.collection(ACCOUNTING_COLLECTIONS.pagos);
  const b = bounds(new URL(req.url).searchParams);

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

    const items = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        fecha: toIso(d.fecha),
        importe: d.importe ?? 0,
        concepto: d.concepto ?? "",
        medio: d.medio ?? "",
        proveedor: d.proveedor ?? "",
        facturaId: d.facturaId ?? "",
        observaciones: d.observaciones ?? "",
        bankReference: d.bankReference ? String(d.bankReference) : "",
        bankReferencia: d.bankReferencia ? String(d.bankReferencia) : "",
      };
    });

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

  const parsed = pagoBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validación fallida", details: parsed.error.flatten() }, { status: 400 });
  }

  const row = parsed.data;
  try {
    const ref = await db.collection(ACCOUNTING_COLLECTIONS.pagos).add({
      empresa: "notificas_srl",
      fecha: Timestamp.fromDate(dateOnlyToUtcMidday(row.fecha)),
      importe: row.importe,
      concepto: row.concepto,
      medio: row.medio ?? null,
      proveedor: row.proveedor ?? null,
      facturaId: row.facturaId ?? null,
      observaciones: row.observaciones ?? null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (e) {
    console.error("[accounting/pagos POST]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
