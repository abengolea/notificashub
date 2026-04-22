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
    // Leer body como texto PRIMERO para detectar parsing/body-consumed issues
    const rawText = await req.text();
    console.log("[webhook-raw]", {
      len: rawText.length,
      hasMessages: rawText.includes('"messages"'),
      hasImage: rawText.includes('"image"'),
      hasStatuses: rawText.includes('"statuses"'),
      preview: rawText.slice(0, 250),
    });

    let body: unknown;
    try {
      body = rawText ? JSON.parse(rawText) : {};
    } catch (parseErr) {
      console.error("[webhook-raw] JSON parse failed:", parseErr);
      return NextResponse.json({ ok: true });
    }

    interface WebhookBody {
      entry?: Array<{
        changes?: Array<{
          value?: {
            messages?: Array<{ from?: string; type?: string; id?: string }>;
            statuses?: unknown[];
            contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
          };
        }>;
      }>;
    }
    const b = body as WebhookBody;
    // Debug: último webhook recibido
    const hasMessages = !!(
      b?.entry?.some?.(
        (e) => e?.changes?.some?.((c) => c?.value?.messages?.length)
      ) ?? b?.entry?.[0]?.changes?.[0]?.value?.messages?.length
    );
    const statuses = extractStatuses(body);
    const from = b?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from ??
      b?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.wa_id;

    setLastWebhook({
      at: new Date().toISOString(),
      hasMessage: hasMessages,
      hasStatuses: statuses.length > 0,
      from: from as string | undefined,
      messageType: b?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.type as string | undefined,
      bodyKeys: body && typeof body === "object" ? Object.keys(body) : [],
      valueKeys: b?.entry?.[0]?.changes?.[0]?.value
        ? Object.keys(b.entry[0].changes[0].value)
        : [],
    });

    // Summary estructurado del payload (antes de extractIncomingMessages)
    const allMessages = b?.entry?.flatMap?.((e) =>
      (e?.changes ?? []).flatMap((c) => c?.value?.messages ?? [])
    ) ?? [];
    const messageTypes = allMessages.map((m: unknown) => (m as { type?: string })?.type ?? "?");
    const hasStatuses = b?.entry?.some?.((e) =>
      (e?.changes ?? []).some((c) => Array.isArray(c?.value?.statuses))
    ) ?? false;
    console.log("[webhook] summary", {
      hasEntry: !!b?.entry,
      entriesCount: b?.entry?.length ?? 0,
      changesCount: b?.entry?.flatMap?.((e) => e?.changes ?? [])?.length ?? 0,
      hasMessages: allMessages.length > 0,
      messageCount: allMessages.length,
      messageTypes,
      hasStatuses,
    });
    if (allMessages.length > 0) {
      console.log("[webhook] *** INCOMING MESSAGE ***", {
        types: messageTypes,
        firstId: (allMessages[0] as { id?: string })?.id?.slice(0, 30),
      });
    }

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
