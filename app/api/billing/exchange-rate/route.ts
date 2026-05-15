import { NextRequest, NextResponse } from "next/server";
import { requireDashboard } from "@/lib/require-dashboard";
import { fetchCotizacionDolarReferencia } from "@/lib/billing/exchange-rate";

export async function GET(req: NextRequest) {
  const denied = await requireDashboard(req);
  if (denied) return denied;

  try {
    const c = await fetchCotizacionDolarReferencia();
    return NextResponse.json(c);
  } catch (e) {
    console.error("[billing/exchange-rate GET]", e);
    const msg = e instanceof Error ? e.message : "Error obteniendo cotización";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
