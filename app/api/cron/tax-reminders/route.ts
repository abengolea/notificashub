import { NextRequest, NextResponse } from "next/server";
import { processTaxReminders } from "@/lib/tax-reminders/process-reminders";

/** Cron Cloud / Vercel / manual: dispará con Authorization: Bearer ${CRON_SECRET} */
export async function GET(req: NextRequest) {
  return handleCron(req);
}

export async function POST(req: NextRequest) {
  return handleCron(req);
}

async function handleCron(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim()
    ?? req.headers.get("x-cron-secret")?.trim();
  const envSecret = process.env.CRON_SECRET?.trim();

  if (!envSecret) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "CRON_SECRET no está definido en el servidor — agregalo al entorno antes de automatizar.",
      },
      { status: 503 }
    );
  }

  if (secret !== envSecret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const r = await processTaxReminders();
    return NextResponse.json({ ok: true, result: r });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron/tax-reminders]", e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
