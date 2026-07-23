import { NextRequest } from "next/server";
import { requireExtension } from "@/lib/require-extension";
import { resolveAccountingEntity } from "@/lib/accounting/constants";
import { exportCm05Period } from "@/lib/sifere-cm05/period-export";
import { CM05_DEFAULT_JURISDICCION, isCm05Jurisdiccion } from "@/lib/sifere-cm05/jurisdictions";

/**
 * GET /api/extension/export-cm05?year=&month=&jurisdiccion=902&entity=
 * Mismo archivo que /api/accounting/export-cm05, pero con el token de la extensión en vez
 * de la contraseña completa del dashboard — la extensión lo descarga para dejarlo listo
 * antes de que el usuario lo suba a mano en SIFERE WEB.
 */
export async function GET(req: NextRequest) {
  const denied = await requireExtension(req);
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
    const file = await exportCm05Period({ year: y, month: m, jurisdiccion: jurRaw, entityId: entity.id });
    return new Response(new Uint8Array(file.buffer), {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[extension/export-cm05]", err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}
