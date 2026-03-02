import { NextRequest, NextResponse } from "next/server";

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
    const value = body?.entry?.[0]?.changes?.[0]?.value;
    const statuses = value?.statuses;

    // Reenviar mensajes entrantes a HeartLink (no bloqueante: Meta recibe 200 enseguida)
    const message = value?.messages?.[0];
    const from = message?.from ?? value?.contacts?.[0]?.wa_id;

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
      fetch(`${heartlinkUrl}/api/whatsapp/incoming`, {
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
      })
        .then(async (res) => {
          if (!res.ok) {
            console.error("[NotificasHub] HeartLink respondió:", res.status, await res.text());
          } else {
            console.log("[NotificasHub] HeartLink OK:", res.status);
          }
        })
        .catch((err) => {
          console.error("[NotificasHub] Error reenviando a HeartLink:", err);
        });
    }

    if (!statuses || statuses.length === 0) {
      return NextResponse.json({ ok: true });
    }

    for (const status of statuses) {
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
