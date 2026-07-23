import { NextRequest } from "next/server";
import { requireDashboard } from "@/lib/require-dashboard";
import { resolveAccountingEntity } from "@/lib/accounting/constants";
import { loadBienesPersonalesYear, buildBienesPersonalesXlsx } from "@/lib/bienes-personales/period-export";

/**
 * GET /api/accounting/bienes/export?year=&entity=
 * Descarga detalle + totales de patrimonio del año (.xlsx) para armar la DDJJ Bienes Personales.
 */
export async function GET(req: NextRequest) {
  const denied = await requireDashboard(req);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const entity = resolveAccountingEntity(searchParams);
  const y = parseInt(searchParams.get("year") ?? "", 10);

  if (!Number.isFinite(y)) {
    return new Response(JSON.stringify({ error: "Query year requerido" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const data = await loadBienesPersonalesYear({ year: y, entityId: entity.id });
    const file = buildBienesPersonalesXlsx(data);
    return new Response(new Uint8Array(file.buffer), {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Cache-Control": "no-store",
        "X-Bienes-Patrimonio-Neto": String(data.patrimonioNeto),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[bienes/export]", err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}
