import { NextRequest, NextResponse } from "next/server";
import { requireDashboard } from "@/lib/require-dashboard";
import { resolveAccountingEntity } from "@/lib/accounting/constants";
import { loadGananciasYear } from "@/lib/ganancias/period-export";
import { revisarGananciasConModelo } from "@/lib/ganancias/verify-ai";

/**
 * POST /api/accounting/ganancias/verify-ai
 * Revisión de coherencia por IA sobre el resumen anual ya calculado (no recalcula nada).
 */
export async function POST(req: NextRequest) {
  const denied = await requireDashboard(req);
  if (denied) return denied;

  if (!process.env.GOOGLE_AI_API_KEY?.trim()) {
    return NextResponse.json({ error: "GOOGLE_AI_API_KEY no configurada en el servidor." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const entity = resolveAccountingEntity(
    new URL(req.url).searchParams,
    (body as { entity?: unknown }).entity
  );
  const y = Number((body as { year?: unknown }).year);
  if (!Number.isFinite(y)) {
    return NextResponse.json({ error: "Falta year" }, { status: 400 });
  }

  try {
    const data = await loadGananciasYear({ year: y, entityId: entity.id });
    const mesesConIngresoCero = data.months.filter((m) => m.ingresoBruto === 0).map((m) => m.month);
    const mesesConGastoSinIngreso = data.months
      .filter((m) => m.ingresoBruto === 0 && m.totalGastosDeducibles > 0)
      .map((m) => m.month);

    const texto = await revisarGananciasConModelo({
      year: data.year,
      entityDisplayName: data.entityDisplayName,
      isIndividual: data.deducciones.length > 0 || entity.isIndividual,
      totalIngresoBruto: data.totalIngresoBruto,
      totalGastosDeducibles: data.totalGastosDeducibles,
      totalDeduccionesPersonales: data.totalDeduccionesPersonales,
      totalResultadoNeto: data.totalResultadoNeto,
      mesesConIngresoCero,
      mesesConGastoSinIngreso,
    });
    return NextResponse.json({ texto });
  } catch (e) {
    console.error("[ganancias/verify-ai POST]", e);
    const msg = e instanceof Error ? e.message : "Error en verificación";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
