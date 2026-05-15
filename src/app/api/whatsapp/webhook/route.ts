import { NextRequest, NextResponse } from "next/server";
import { setLastWebhook } from "@/lib/webhook-debug";

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
export async function POST(req: NextRequest) {
  const { db } = await import("@/lib/firebase-admin");

  try {
    const body = await req.json();
    const entries = Array.isArray(body?.entry) ? body.entry : [body?.entry].filter(Boolean);

    // Buscar mensajes en cualquier entry/change (Meta puede enviar estructura variada)
    let message: { id?: string; from?: string; type?: string; timestamp?: string; text?: { body?: string } } | undefined;
    let from: string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let value: any;
    let statuses: unknown[] | undefined;

    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [entry?.changes].filter(Boolean);
      for (const change of changes) {
        const v = change?.value;
        if (!v) continue;
        if (v.messages?.length) {
          message = v.messages[0];
          from = message?.from ?? v?.contacts?.[0]?.wa_id;
          value = v;
          break;
        }
        if (v.statuses) {
          statuses = v.statuses;
          value = v;
        }
      }
      if (message) break;
    }

    // Fallback: estructura clásica
    if (!message && body?.entry?.[0]?.changes?.[0]?.value) {
      value = body.entry[0].changes[0].value;
      const v = value as { messages?: Array<{ from?: string }>; contacts?: { wa_id?: string }[]; statuses?: unknown[] };
      const msg = v?.messages?.[0];
      message = msg as typeof message;
      from = (msg as { from?: string })?.from ?? v?.contacts?.[0]?.wa_id;
      statuses = v?.statuses;
    }

    // Log cuando recibimos webhook de Meta
    const hasMessages = !!message;
    const hasStatuses = !!(statuses?.length);
    console.log("[NotificasHub] Webhook Meta recibido:", {
      hasMessages,
      hasStatuses,
      from: from ?? message?.from ?? "?",
      messageType: message?.type,
      heartlinkConfig: !!(process.env.HEARTLINK_URL && process.env.INTERNAL_SECRET),
      bodyKeys: body ? Object.keys(body) : [],
    });
    if (!message && body?.entry) {
      console.log("[NotificasHub] Debug payload:", JSON.stringify({
        entryCount: body.entry?.length,
        firstEntryKeys: body.entry?.[0] ? Object.keys(body.entry[0]) : [],
        firstChange: body.entry?.[0]?.changes?.[0] ? Object.keys(body.entry[0].changes[0]) : [],
        valueKeys: body.entry?.[0]?.changes?.[0]?.value ? Object.keys(body.entry[0].changes[0].value) : [],
      }));
    }

    setLastWebhook({
      at: new Date().toISOString(),
      hasMessage: !!message,
      hasStatuses: !!(statuses?.length),
      from: from ?? message?.from,
      messageType: message?.type,
      bodyKeys: body ? Object.keys(body) : [],
      valueKeys: value ? Object.keys(value) : [],
    });

    // Debug: loggear si falta config (solo en producción para depurar)
    if (message && !from) {
      console.warn("[NotificasHub] Mensaje sin from:", { messageFrom: message?.from, contacts: value?.contacts });
    }
    if (message && from && (!process.env.HEARTLINK_URL || !process.env.INTERNAL_SECRET)) {
      console.warn("[NotificasHub] Falta HEARTLINK_URL o INTERNAL_SECRET, no se reenvía");
    }

    if (message && from && process.env.HEARTLINK_URL && process.env.INTERNAL_SECRET) {
      const heartlinkUrl = process.env.HEARTLINK_URL;
      const secret = process.env.INTERNAL_SECRET;
      console.log("[NotificasHub] Reenviando a HeartLink:", { from, messageId: message.id, type: message.type });
      try {
        const res = await fetch(`${heartlinkUrl}/api/whatsapp/incoming`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-token": secret,
          },
          body: JSON.stringify({
            message,
            from: String(from),
            contactName: value?.contacts?.[0]?.profile?.name,
            messageId: message.id,
            timestamp: message.timestamp,
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          console.error("[NotificasHub] HeartLink error:", res.status, text);
        } else {
          console.log("[NotificasHub] Reenvío OK → HeartLink:", res.status);
        }
      } catch (err) {
        console.error("[NotificasHub] Error reenviando a HeartLink:", err);
      }
    }

    if (!statuses || statuses.length === 0) {
      return NextResponse.json({ ok: true });
    }

    for (const s of statuses) {
      const status = s as { id: string; status: string; timestamp: string };
      const messageId = status.id;
      const newStatus = status.status; // sent, delivered, read, failed
      const timestamp = status.timestamp;

      const ref = db.collection("whatsappMessages").doc(messageId);
      const snap = await ref.get();

      if (!snap.exists) {
        console.warn("[webhook] Mensaje no encontrado:", messageId);
        continue;
      }

      const update: Record<string, unknown> = { status: newStatus };

      if (newStatus === "delivered") update.deliveredAt = new Date(Number(timestamp) * 1000);
      if (newStatus === "read") update.readAt = new Date(Number(timestamp) * 1000);
      if (newStatus === "failed") update.failedAt = new Date(Number(timestamp) * 1000);

      await ref.update(update);
      console.log(`[webhook] Mensaje ${messageId} → ${newStatus}`);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[webhook] Error:", e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
