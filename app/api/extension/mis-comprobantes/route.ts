import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireExtension } from "@/lib/require-extension";
import { resolveAccountingEntity } from "@/lib/accounting/constants";
import { persistMisComprobantes } from "@/lib/arca-mis-comprobantes/persist";
import type { MisComprobanteRow } from "@/lib/arca-mis-comprobantes/parse";

export const runtime = "nodejs";

const rowSchema = z.object({
  kind: z.enum(["emitido", "recibido"]),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tipoCodigo: z.number().int(),
  puntoVenta: z.string(),
  numero: z.string(),
  cae: z.string().optional().default(""),
  contraparteCuit: z.string().optional().default(""),
  contraparteNombre: z.string().optional().default(""),
  netoGravado: z.number().finite(),
  netoNoGravado: z.number().finite().optional().default(0),
  opExentas: z.number().finite().optional().default(0),
  otrosTributos: z.number().finite().optional().default(0),
  iva: z.number().finite(),
  total: z.number().finite(),
  moneda: z.string().optional().default("PES"),
  tipoCambio: z.number().finite().optional().default(1),
});

const bodySchema = z.object({
  rows: z.array(rowSchema).min(1).max(500),
  dryRun: z.boolean().optional(),
});

/**
 * POST /api/extension/mis-comprobantes
 * Recibe filas ya leídas por la extensión desde "Mis Comprobantes Recibidos/Emitidos" de ARCA
 * (mismo shape que produce el import por CSV/XLS, sin pasar por el parser de archivo) y las
 * persiste con el mismo pipeline de dedup que ya usa el import manual.
 */
export async function POST(req: NextRequest) {
  const denied = await requireExtension(req);
  if (denied) return denied;

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

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validación fallida", details: parsed.error.flatten() }, { status: 400 });
  }

  const rows = parsed.data.rows as MisComprobanteRow[];

  if (parsed.data.dryRun) {
    return NextResponse.json({
      dryRun: true,
      total: rows.length,
      preview: rows.slice(0, 40),
    });
  }

  try {
    const result = await persistMisComprobantes(rows, entity.id);
    return NextResponse.json({ total: rows.length, ...result });
  } catch (e) {
    console.error("[extension/mis-comprobantes]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error al importar" },
      { status: 500 }
    );
  }
}
