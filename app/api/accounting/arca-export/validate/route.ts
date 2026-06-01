import { NextRequest, NextResponse } from "next/server";
import { requireDashboard } from "@/lib/require-dashboard";
import { loadPeriodExportData, validateArcaExport } from "@/lib/arca-export/period-export";

/** GET /api/accounting/arca-export/validate?year=&month= */
export async function GET(req: NextRequest) {
  const denied = await requireDashboard(req);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const y = parseInt(searchParams.get("year") ?? "", 10);
  const m = parseInt(searchParams.get("month") ?? "", 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return NextResponse.json({ error: "Query year y month requeridos (1-12)" }, { status: 400 });
  }

  try {
    const data = await loadPeriodExportData(y, m);
    const validation = validateArcaExport(data);
    return NextResponse.json({
      ...validation,
      resumen: data.resumenIvahub,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[arca-export/validate]", err);
    return NextResponse.json({ error: "Error interno", detalle: msg }, { status: 500 });
  }
}
