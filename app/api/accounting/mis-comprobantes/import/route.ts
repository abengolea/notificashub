import { NextRequest, NextResponse } from "next/server";
import { requireDashboard } from "@/lib/require-dashboard";
import { resolveAccountingEntity } from "@/lib/accounting/constants";
import { parseMisComprobantesBuffer } from "@/lib/arca-mis-comprobantes/parse-file";
import { persistMisComprobantes } from "@/lib/arca-mis-comprobantes/persist";

export const runtime = "nodejs";

/**
 * POST multipart: file (+ optional dryRun=1).
 * Importa CSV/XLS de Mis Comprobantes (emitidos → ventas, recibidos → gastos).
 */
export async function POST(req: NextRequest) {
  const denied = await requireDashboard(req);
  if (denied) return denied;

  try {
    const form = await req.formData();
    const entity = resolveAccountingEntity(
      new URL(req.url).searchParams,
      form.get("entity")
    );
    const file = form.get("file");
    const dryRun = String(form.get("dryRun") ?? "") === "1";

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Adjuntá un archivo CSV o XLS de Mis Comprobantes" }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const parsed = parseMisComprobantesBuffer(buf, file.name || "mis-comprobantes.csv");

    if (!parsed.rows.length) {
      return NextResponse.json(
        {
          error: "No se leyeron comprobantes. ¿Es el export CSV/XLS de Mis Comprobantes?",
          warnings: parsed.warnings,
          kind: parsed.kind,
        },
        { status: 422 }
      );
    }

    if (dryRun) {
      const preview = parsed.rows.slice(0, 40).map((r) => ({
        kind: r.kind,
        fecha: r.fecha,
        tipo: r.tipoCodigo,
        pv: r.puntoVenta,
        numero: r.numero,
        contraparte: r.contraparteNombre,
        cuit: r.contraparteCuit,
        neto: r.netoGravado,
        iva: r.iva,
        total: r.total,
      }));
      return NextResponse.json({
        dryRun: true,
        kind: parsed.kind,
        total: parsed.rows.length,
        warnings: parsed.warnings,
        preview,
      });
    }

    const result = await persistMisComprobantes(parsed.rows, entity.id);
    return NextResponse.json({
      kind: parsed.kind,
      total: parsed.rows.length,
      warnings: parsed.warnings,
      ...result,
    });
  } catch (e) {
    console.error("[mis-comprobantes import]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error al importar" },
      { status: 500 }
    );
  }
}
