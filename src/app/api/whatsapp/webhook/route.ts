import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase-admin";

// TODO: usar process.env.WHATSAPP_VERIFY_TOKEN cuando esté configurado en Firebase App Hosting
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN ?? "notificas_webhook_2026";

// Meta verifica el webhook con un GET
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

// Meta manda los eventos de estado con un POST
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const statuses = body?.entry?.[0]?.changes?.[0]?.value?.statuses;

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
