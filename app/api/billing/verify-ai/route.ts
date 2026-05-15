import { NextRequest, NextResponse } from "next/server";
import { requireDashboard } from "@/lib/require-dashboard";
import { billingVerifyAiBodySchema } from "@/lib/billing/schemas";
import { verificarBorradorConModelo } from "@/lib/billing/verify-draft-ai";

export async function POST(req: NextRequest) {
  const denied = await requireDashboard(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = billingVerifyAiBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validación fallida", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const texto = await verificarBorradorConModelo(parsed.data);
    return NextResponse.json({ texto });
  } catch (e) {
    console.error("[billing/verify-ai POST]", e);
    const msg = e instanceof Error ? e.message : "Error en verificación";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
