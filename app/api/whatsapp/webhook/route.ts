import { NextRequest, NextResponse } from "next/server";
import { setLastWebhook } from "@/lib/webhook-debug";
import {
  handleIncomingWebhook,
  extractStatuses,
} from "@/src/whatsapp/webhook-handler";

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN ?? "notificas_webhook_2026";

// Meta verifica el webhook con un GET (sin Firebase Admin para que siempre responda)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return NextResponse.json({ error: "Token inválido" }, { status: 403 });
}

// Meta manda mensajes entrantes y eventos de estado con un POST
// Router multi-tenant: resolve tenant, idempotencia, auditoría
export async function POST(req: NextRequest) {
  const { db } = await import("@/lib/firebase-admin");

  try {
    const body = await req.json();

    // Debug: último webhook recibido
    const hasMessages = !!(
      body?.entry?.some?.(
        (e: { changes?: { value?: { messages?: unknown[] } }[] }) =>
          e?.changes?.some?.((c) => c?.value?.messages?.length)
      ) ?? body?.entry?.[0]?.changes?.[0]?.value?.messages?.length
    );
    const statuses = extractStatuses(body);
    const from = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from ??
      body?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.wa_id;

    setLastWebhook({
      at: new Date().toISOString(),
      hasMessage: hasMessages,
      hasStatuses: statuses.length > 0,
      from,
      messageType: body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.type,
      bodyKeys: body ? Object.keys(body) : [],
      valueKeys: body?.entry?.[0]?.changes?.[0]?.value
        ? Object.keys(body.entry[0].changes[0].value)
        : [],
    });

    // Router multi-tenant: procesa mensajes entrantes (idempotente)
    const { messages: msgResult } = await handleIncomingWebhook(db, body);
    if (msgResult.errors.length > 0) {
      console.error("[NotificasHub] Router errors:", msgResult.errors);
    }
    if (msgResult.processed > 0 || msgResult.duplicate > 0) {
      console.log("[NotificasHub] Router:", {
        processed: msgResult.processed,
        duplicate: msgResult.duplicate,
      });
    }

    // Actualizar statuses en whatsappMessages (legacy)
    for (const s of statuses) {
      const messageId = s.id;
      const newStatus = s.status;
      const timestamp = s.timestamp;

      const ref = db.collection("whatsappMessages").doc(messageId);
      const snap = await ref.get();

      if (!snap.exists) {
        console.warn("[webhook] Mensaje no encontrado para status:", messageId);
        continue;
      }

      const update: Record<string, unknown> = { status: newStatus };
      if (newStatus === "delivered") update.deliveredAt = new Date(Number(timestamp) * 1000);
      if (newStatus === "read") update.readAt = new Date(Number(timestamp) * 1000);
      if (newStatus === "failed") update.failedAt = new Date(Number(timestamp) * 1000);
      if (s.pricingCategory) update.pricingCategory = s.pricingCategory;

      await ref.update(update);
      console.log(`[webhook] Mensaje ${messageId} → ${newStatus}`);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[webhook] Error:", e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
