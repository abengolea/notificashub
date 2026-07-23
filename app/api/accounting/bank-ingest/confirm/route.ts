import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { NormalizedBankMovement } from "@/lib/accounting/bank-extract";
import { persistBankMovements } from "@/lib/accounting/bank-import";
import { resolveAccountingEntity } from "@/lib/accounting/constants";
import { medioPagoSchema, taxSubcategorySchema } from "@/lib/accounting/schemas";
import { requireDashboard } from "@/lib/require-dashboard";

const vepHintSchema = z.object({
  isVep: z.literal(true),
  taxSubcategory: taxSubcategorySchema,
  isIncomeTaxDeductible: z.boolean(),
});

const movementSchema = z.object({
  bankReference: z.string().min(8).max(128),
  kind: z.enum(["cobro", "pago"]),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  importe: z.number().finite().positive(),
  concepto: z.string().min(1).max(512),
  medio: medioPagoSchema.optional(),
  referenciaBanco: z.string().max(64).optional(),
  observaciones: z.string().max(2000).optional(),
  selected: z.boolean().optional(),
  vepHint: vepHintSchema.nullable().optional(),
});

const bodySchema = z.object({
  pdfStoragePath: z.string().max(512).optional(),
  entity: z.string().optional(),
  movements: z.array(movementSchema).min(1).max(200),
});

export async function POST(req: NextRequest) {
  const denied = await requireDashboard(req);
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
    return NextResponse.json(
      { error: "Validación fallida", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const toImport: NormalizedBankMovement[] = [];
  for (const row of parsed.data.movements) {
    if (row.selected === false) continue;
    toImport.push({
      bankReference: row.bankReference,
      kind: row.kind,
      fecha: row.fecha,
      importe: row.importe,
      concepto: row.concepto,
      medio: row.medio ?? "transferencia",
      referenciaBanco: row.referenciaBanco ?? "sin-ref",
      observaciones: row.observaciones,
      ...(row.vepHint ? { vepHint: row.vepHint } : {}),
    });
  }

  if (toImport.length === 0) {
    return NextResponse.json({ error: "No hay movimientos seleccionados para importar." }, { status: 400 });
  }

  try {
    const result = await persistBankMovements({
      movements: toImport,
      pdfStoragePath: parsed.data.pdfStoragePath,
    });

    return NextResponse.json({
      ok: true,
      requested: toImport.length,
      ...result,
    });
  } catch (e) {
    console.error("[accounting/bank-ingest/confirm]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
