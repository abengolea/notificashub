import { NextRequest } from "next/server";
import { requireDashboard } from "@/lib/require-dashboard";
import { resolveAccountingEntity } from "@/lib/accounting/constants";
import { exportCm05Period } from "@/lib/sifere-cm05/period-export";
import {
  CM05_DEFAULT_JURISDICCION,
  isCm05Jurisdiccion,
} from "@/lib/sifere-cm05/jurisdictions";

/**
 * GET /api/accounting/export-cm05?year=&month=&jurisdiccion=902
 * Descarga planilla auxiliar CM05 (.xls) para importar en SIFERE WEB / ARCA.
 */
export async function GET(req: NextRequest) {
  const denied = await requireDashboard(req);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const entity = resolveAccountingEntity(searchParams);
  const y = parseInt(searchParams.get("year") ?? "", 10);
  const m = parseInt(searchParams.get("month") ?? "", 10);
  const jurRaw = (searchParams.get("jurisdiccion") ?? CM05_DEFAULT_JURISDICCION).trim();

  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return new Response(JSON.stringify({ error: "Query year y month requeridos" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!isCm05Jurisdiccion(jurRaw)) {
    return new Response(JSON.stringify({ error: "jurisdiccion inválida (901–924)" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const file = await exportCm05Period({
      year: y,
      month: m,
      jurisdiccion: jurRaw,
      entityId: entity.id,
    });
    return new Response(new Uint8Array(file.buffer), {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Cache-Control": "no-store",
        "X-Cm05-Ingresos": String(file.summary.ingresosNeto),
        "X-Cm05-Gastos": String(file.summary.gastosNeto),
        "X-Cm05-Jurisdiccion": file.summary.jurisdiccion,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[export-cm05]", err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}
