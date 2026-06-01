import { NextRequest } from "next/server";
import { requireDashboard } from "@/lib/require-dashboard";
import {
  getArcaArchivoDownload,
  isComprasArchivo,
  isVentasArchivo,
  loadPeriodExportData,
  parseArcaArchivoId,
  validateArcaExport,
} from "@/lib/arca-export/export-bundle";

/**
 * GET /api/accounting/export-libro-iva?year=&month=&archivo=compras_cbte|compras_ali|ventas_cbte|ventas_ali
 * Descarga un .txt ANSI por archivo (sin ZIP).
 */
export async function GET(req: NextRequest) {
  const denied = await requireDashboard(req);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const y = parseInt(searchParams.get("year") ?? "", 10);
  const m = parseInt(searchParams.get("month") ?? "", 10);
  const archivo = parseArcaArchivoId(searchParams.get("archivo"));
  const skipValidation = searchParams.get("force") === "1";

  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return new Response(JSON.stringify({ error: "Query year y month requeridos" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!archivo) {
    return new Response(
      JSON.stringify({
        error: "Query archivo requerido",
        archivos: ["compras_cbte", "compras_ali", "ventas_cbte", "ventas_ali"],
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const data = await loadPeriodExportData(y, m);
    const validation = validateArcaExport(data);

    if (!skipValidation && isComprasArchivo(archivo) && validation.compras.comprobantes === 0) {
      return new Response(
        JSON.stringify({
          error: "No hay comprobantes de compras para exportar",
          validation,
        }),
        { status: 422, headers: { "Content-Type": "application/json; charset=utf-8" } }
      );
    }

    if (!skipValidation && isVentasArchivo(archivo) && validation.ventas.comprobantes === 0) {
      return new Response(
        JSON.stringify({
          error: "No hay comprobantes de ventas para exportar",
          validation,
        }),
        { status: 422, headers: { "Content-Type": "application/json; charset=utf-8" } }
      );
    }

    const { buffer, filename, contentType } = getArcaArchivoDownload(data, archivo);

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-Arca-Validation-Warnings": String(validation.warnings.length),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[export-libro-iva]", err);
    const status = msg.includes("[LibroIVA") ? 422 : 500;
    return new Response(
      JSON.stringify({
        error: status === 422 ? "Fallo al armar registros ARCA" : "Error interno",
        detalle: msg,
      }),
      {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }
}
