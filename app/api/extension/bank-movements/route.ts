import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireExtension } from "@/lib/require-extension";
import { resolveAccountingEntity } from "@/lib/accounting/constants";
import {
  defaultBankAccountId,
  normalizeBankExtractRows,
  type RawBankMovement,
} from "@/lib/accounting/bank-extract";
import { enrichWithDuplicateFlags, persistBankMovements } from "@/lib/accounting/bank-import";

export const runtime = "nodejs";

const rawMovementSchema = z.object({
  fecha: z.string(),
  importe: z.number().finite(),
  concepto: z.string(),
  referenciaBanco: z.string().optional(),
  saldo: z.number().finite().optional(),
  clasificacion: z.string().optional(),
});

const bodySchema = z.object({
  movements: z.array(rawMovementSchema).min(1).max(500),
  cuentaNumero: z.string().optional(),
  dryRun: z.boolean().optional(),
});

/**
 * POST /api/extension/bank-movements
 * Recibe filas ya leídas por la extensión desde el extracto de Banco Macro (mismo shape que
 * hoy arma la extracción por IA desde el PDF) y las procesa con el mismo pipeline de
 * normalización/dedup/persistencia que usa el import por PDF, sin pasar por Gemini.
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
  if (!entity.integrations.bankIngest) {
    return NextResponse.json(
      { error: "Importación bancaria solo disponible para Notificas SRL" },
      { status: 400 }
    );
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validación fallida", details: parsed.error.flatten() }, { status: 400 });
  }

  const cuentaNumero = parsed.data.cuentaNumero?.trim() || defaultBankAccountId();
  const normalized = normalizeBankExtractRows(parsed.data.movements as RawBankMovement[], cuentaNumero);

  if (normalized.length === 0) {
    return NextResponse.json({ error: "Ninguna fila pudo interpretarse como movimiento." }, { status: 422 });
  }

  const preview = await enrichWithDuplicateFlags(normalized);

  if (parsed.data.dryRun) {
    return NextResponse.json({ dryRun: true, cuentaNumero, movimientos: preview });
  }

  const toImport = preview.filter((m) => !m.duplicate);
  if (toImport.length === 0) {
    return NextResponse.json({
      ok: true,
      requested: 0,
      importedCobros: 0,
      importedPagos: 0,
      skippedDuplicates: preview.length,
      errors: [],
    });
  }

  try {
    const result = await persistBankMovements({ movements: toImport });
    return NextResponse.json({ ok: true, requested: toImport.length, ...result });
  } catch (e) {
    console.error("[extension/bank-movements]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
