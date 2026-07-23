import { NextRequest, NextResponse } from "next/server";
import { requireDashboard } from "@/lib/require-dashboard";
import { resolveAccountingEntity } from "@/lib/accounting/constants";
import { syncVentasWsfePeriod } from "@/lib/afip/sync-ventas";

/**
 * POST /api/accounting/afip/sync-ventas  JSON { year, month }
 * Sincroniza facturas emitidas del período vía WSFE (certificado propio).
 */
export async function POST(req: NextRequest) {
  const denied = await requireDashboard(req);
  if (denied) return denied;

  let body: { year?: number; month?: number; entity?: unknown } = {};
  try {
    body = (await req.json()) as { year?: number; month?: number; entity?: unknown };
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const entity = resolveAccountingEntity(new URL(req.url).searchParams, body.entity);
  if (!entity.integrations.afipSyncVentas) {
    return NextResponse.json(
      { error: "Sincronización AFIP solo disponible para Notificas SRL" },
      { status: 400 }
    );
  }

  const year = Number(body.year);
  const month = Number(body.month);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "year y month requeridos" }, { status: 400 });
  }

  try {
    const result = await syncVentasWsfePeriod({ year, month });
    if (result.errors.length && result.imported === 0 && result.consulted === 0) {
      return NextResponse.json(result, { status: 422 });
    }
    return NextResponse.json(result);
  } catch (e) {
    console.error("[afip/sync-ventas]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error al sincronizar" },
      { status: 500 }
    );
  }
}
