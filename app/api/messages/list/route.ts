import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase-admin";
import { validateDashboardAccess } from "@/lib/auth-admin";
import type { Timestamp } from "firebase-admin/firestore";

function toIsoString(val: Timestamp | Date | unknown): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  const t = val as { toDate?: () => Date };
  return t.toDate?.()?.toISOString() ?? null;
}

function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const today = new Date();
  return (
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear()
  );
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const passwordHeader = req.headers.get("x-dashboard-password");
  const valid = await validateDashboardAccess(authHeader, passwordHeader);
  if (!valid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const appId = searchParams.get("appId") || undefined;

  try {
    const col = db.collection("whatsappMessages");
    const snap = appId
      ? await col
          .where("appId", "==", appId)
          .orderBy("createdAt", "desc")
          .limit(100)
          .get()
      : await col.orderBy("createdAt", "desc").limit(100).get();

    const messages = snap.docs.map((doc) => {
      const data = doc.data();
      const createdAt = toIsoString(data?.createdAt);
      return {
        messageId: doc.id,
        fecha: createdAt,
        appId: data?.appId ?? "-",
        numero: data?.to ?? data?.recipient ?? data?.phone ?? "-",
        plantilla: data?.template ?? data?.templateName ?? "-",
        status: data?.status ?? "sent",
        sentAt: toIsoString(data?.sentAt),
        deliveredAt: toIsoString(data?.deliveredAt),
        readAt: toIsoString(data?.readAt),
      };
    });

    const todayCounts = { total: 0, delivered: 0, read: 0, failed: 0 };
    for (const m of messages) {
      if (!isToday(m.fecha)) continue;
      todayCounts.total++;
      if (m.status === "delivered") todayCounts.delivered++;
      else if (m.status === "read") todayCounts.read++;
      else if (m.status === "failed") todayCounts.failed++;
    }

    return NextResponse.json({
      messages,
      stats: {
        totalToday: todayCounts.total,
        deliveredToday: todayCounts.delivered,
        readToday: todayCounts.read,
        failedToday: todayCounts.failed,
      },
      appIds: [...new Set(messages.map((m) => m.appId).filter(Boolean))],
    });
  } catch (e) {
    console.error("[messages/list] Error:", e);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
