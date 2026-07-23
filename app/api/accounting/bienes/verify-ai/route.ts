import { NextRequest, NextResponse } from "next/server";
import { requireDashboard } from "@/lib/require-dashboard";
import { resolveAccountingEntity } from "@/lib/accounting/constants";
import { loadBienesPersonalesYear } from "@/lib/bienes-personales/period-export";
import { revisarBienesPersonalesConModelo } from "@/lib/bienes-personales/verify-ai";

/**
 * POST /api/accounting/bienes/verify-ai
 * Revisión de coherencia por IA sobre el resumen ya calculado del año (no recalcula nada).
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
    const data = await loadBienesPersonalesYear({ year: y, entityId: entity.id });
    const texto = await revisarBienesPersonalesConModelo({
      year: data.year,
      entityDisplayName: data.entityDisplayName,
      totalActivos: data.totalActivos,
      totalPasivos: data.totalPasivos,
      patrimonioNeto: data.patrimonioNeto,
      minimoNoImponible: data.minimoNoImponible,
      impuestoEstimado: data.impuestoEstimado,
      activosPorTipo: data.activosPorTipo,
      cantidadBienes: data.bienes.length,
    });
    return NextResponse.json({ texto });
  } catch (e) {
    console.error("[bienes/verify-ai POST]", e);
    const msg = e instanceof Error ? e.message : "Error en verificación";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
