import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase-admin";
import { validateDashboardAccess } from "@/lib/auth-admin";
import { getTenantInfo } from "@/src/whatsapp/tenants";
import type { Timestamp } from "firebase-admin/firestore";
const MAX_MESSAGES = 1000;

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

function isThisWeek(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  return d >= startOfWeek;
}

function isThisMonth(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

function isPaid(status: string, pricingCategory?: string): boolean {
  if (pricingCategory) return true;
  return status === "delivered" || status === "read";
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const passwordHeader = req.headers.get("x-dashboard-password");
  const valid = await validateDashboardAccess(authHeader, passwordHeader);
  if (!valid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const snap = await db
      .collection("whatsappMessages")
      .orderBy("createdAt", "desc")
      .limit(MAX_MESSAGES)
      .get();

    const byApp = new Map<
      string,
      { today: number; todayPaid: number; week: number; weekPaid: number; month: number; monthPaid: number }
    >();

    for (const doc of snap.docs) {
      const data = doc.data();
      const appId = (data?.appId ?? "-") as string;
      const status = (data?.status ?? "sent") as string;
      const pricingCategory = data?.pricingCategory as string | undefined;
      const createdAt = toIsoString(data?.createdAt);
      const paid = isPaid(status, pricingCategory);

      if (!byApp.has(appId)) {
        byApp.set(appId, {
          today: 0,
          todayPaid: 0,
          week: 0,
          weekPaid: 0,
          month: 0,
          monthPaid: 0,
        });
      }
      const stats = byApp.get(appId)!;

      if (isToday(createdAt)) {
        stats.today++;
        if (paid) stats.todayPaid++;
      }
      if (isThisWeek(createdAt)) {
        stats.week++;
        if (paid) stats.weekPaid++;
      }
      if (isThisMonth(createdAt)) {
        stats.month++;
        if (paid) stats.monthPaid++;
      }
    }

    const apps: Array<{
      appId: string;
      name: string;
      today: { total: number; paid: number };
      week: { total: number; paid: number };
      month: { total: number; paid: number };
    }> = [];

    for (const [appId, stats] of byApp.entries()) {
      if (appId === "-") continue;
      const tenant = await getTenantInfo(db, appId);
      apps.push({
        appId,
        name: tenant?.name ?? appId,
        today: { total: stats.today, paid: stats.todayPaid },
        week: { total: stats.week, paid: stats.weekPaid },
        month: { total: stats.month, paid: stats.monthPaid },
      });
    }

    apps.sort((a, b) => b.month.paid - a.month.paid);

    return NextResponse.json({ apps });
  } catch (e) {
    console.error("[dashboard/stats-by-app] Error:", e);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
