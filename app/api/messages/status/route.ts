import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase-admin";
import type { Timestamp } from "firebase-admin/firestore";

const API_KEY = process.env.NOTIFICASHUB_API_KEY;

function toIsoString(val: Timestamp | Date | unknown): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  const t = val as { toDate?: () => Date };
  return t.toDate?.()?.toISOString() ?? null;
}

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  if (!API_KEY || apiKey !== API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const messageId = searchParams.get("messageId");

  if (!messageId) {
    return NextResponse.json(
      { error: "messageId query param is required" },
      { status: 400 }
    );
  }

  try {
    const snap = await db.collection("whatsappMessages").doc(messageId).get();

    if (!snap.exists) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    const data = snap.data();
    const response = {
      messageId,
      status: data?.status ?? "unknown",
      sentAt: toIsoString(data?.sentAt),
      deliveredAt: toIsoString(data?.deliveredAt),
      readAt: toIsoString(data?.readAt),
    };

    return NextResponse.json(response);
  } catch (e) {
    console.error("[messages/status] Error:", e);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
