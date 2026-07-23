import { NextRequest } from "next/server";
import { requireDashboard } from "@/lib/require-dashboard";
import { resolveAccountingEntity } from "@/lib/accounting/constants";
import { loadGananciasYear, buildGananciasXlsx } from "@/lib/ganancias/period-export";

/**
 * GET /api/accounting/ganancias/export?year=&entity=
 * Descarga resumen anual de Ganancias (.xlsx) para armar la DDJJ / entregar al contador.
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
    const data = await loadGananciasYear({ year: y, entityId: entity.id });
    const file = buildGananciasXlsx(data);
    return new Response(new Uint8Array(file.buffer), {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Cache-Control": "no-store",
        "X-Ganancias-Ingreso-Bruto": String(data.totalIngresoBruto),
        "X-Ganancias-Resultado-Neto": String(data.totalResultadoNeto),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ganancias/export]", err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}
