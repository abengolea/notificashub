import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { requireDashboard } from "@/lib/require-dashboard";
import { ACCOUNTING_COLLECTIONS } from "@/lib/accounting/constants";
import { dateOnlyToUtcMidday } from "@/lib/accounting/dates";
import {
  conceptoFromMpPayment,
  fetchApprovedPaymentsRange,
  medioFromMpPayment,
  mercadoPagoDateToYmdArgentina,
  ymdToMercadoPagoRangeUtc,
} from "@/lib/mercadopago/payments-search";

function defaultRangeYmd(): { begin: string; end: string } {
  const end = new Date();
  const begin = new Date(end);
  begin.setUTCDate(begin.getUTCDate() - 30);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { begin: fmt(begin), end: fmt(end) };
}

export async function POST(req: NextRequest) {
  const denied = await requireDashboard(req);
  if (denied) return denied;

  const token = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  if (!token) {
    return NextResponse.json(
      {
        error:
          "Falta MERCADOPAGO_ACCESS_TOKEN en el servidor (credencial de producción o prueba según corresponda).",
      },
      { status: 503 }
    );
  }

  let body: unknown = {};
  try {
    const raw = await req.text();
    if (raw.trim()) body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const b = body as { begin?: string; end?: string };
  const beginStr = typeof b.begin === "string" && b.begin.trim() ? b.begin.trim() : defaultRangeYmd().begin;
  const endStr = typeof b.end === "string" && b.end.trim() ? b.end.trim() : defaultRangeYmd().end;

  let range: { beginDateIso: string; endDateIso: string };
  try {
    range = ymdToMercadoPagoRangeUtc(beginStr, endStr);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Rango inválido";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  let payments;
  try {
    payments = await fetchApprovedPaymentsRange({
      accessToken: token,
      beginDateIso: range.beginDateIso,
      endDateIso: range.endDateIso,
    });
  } catch (e) {
    console.error("[mercadopago/sync-cobros]", e);
    const msg = e instanceof Error ? e.message : "Error Mercado Pago";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const col = db.collection(ACCOUNTING_COLLECTIONS.cobros);
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const p of payments) {
    const mpId = String(p.id);
    try {
      const dup = await col.where("mercadopagoPaymentId", "==", mpId).limit(1).get();
      if (!dup.empty) {
        skipped += 1;
        continue;
      }

      const created = p.date_created;
      if (!created) {
        errors.push(`Pago ${mpId}: sin date_created`);
        continue;
      }

      const ymd = mercadoPagoDateToYmdArgentina(created);
      const amount = Number(p.transaction_amount);
      if (!Number.isFinite(amount) || amount < 0) {
        errors.push(`Pago ${mpId}: importe inválido`);
        continue;
      }

      await col.add({
        empresa: "notificas_srl",
        fecha: Timestamp.fromDate(dateOnlyToUtcMidday(ymd)),
        importe: amount,
        concepto: conceptoFromMpPayment(p),
        medio: medioFromMpPayment(p),
        facturaId: null,
        mercadopagoPaymentId: mpId,
        observaciones:
          `Importado Mercado Pago · pago ${mpId}` +
          (p.payer?.email ? ` · ${String(p.payer.email)}` : "") +
          (p.payment_type_id ? ` · ${p.payment_type_id}` : ""),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      imported += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`Pago ${mpId}: ${msg}`);
    }
  }

  return NextResponse.json({
    ok: true,
    range: { begin: beginStr, end: endStr },
    fromMercadoPago: payments.length,
    imported,
    skippedDuplicates: skipped,
    errors: errors.length ? errors : undefined,
  });
}
