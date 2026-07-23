import { NextRequest, NextResponse } from "next/server";
import { requireDashboard } from "@/lib/require-dashboard";
import { resolveAccountingEntity } from "@/lib/accounting/constants";
import { loadGananciasYear } from "@/lib/ganancias/period-export";

/**
 * GET /api/accounting/ganancias?year=&entity=
 * Resumen mensual/anual de ingresos, gastos deducibles y resultado neto (devengado).
 */
export async function GET(req: NextRequest) {
  const denied = await requireDashboard(req);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const entity = resolveAccountingEntity(searchParams);
  const y = parseInt(searchParams.get("year") ?? "", 10);
  if (!Number.isFinite(y)) {
    return NextResponse.json({ error: "Query year requerido" }, { status: 400 });
  }

  try {
    const data = await loadGananciasYear({ year: y, entityId: entity.id });
    return NextResponse.json(data);
  } catch (e) {
    console.error("[accounting/ganancias GET]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
