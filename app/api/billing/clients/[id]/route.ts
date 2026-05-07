import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { requireDashboard } from "@/lib/require-dashboard";
import { BILLING_CLIENTS_COLLECTION } from "@/lib/billing/constants";
import { billingClientPatchSchema } from "@/lib/billing/schemas";

type RouteContext = { params: Promise<{ id: string }> };

function normalizeCuit(s: string): string {
  return s.replace(/\D/g, "").slice(0, 11);
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const denied = await requireDashboard(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "id requerido" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = billingClientPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validación fallida", details: parsed.error.flatten() }, { status: 400 });
  }

  const b = parsed.data;
  const ref = db.collection(BILLING_CLIENTS_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (b.active !== undefined) patch.active = b.active;
  if (b.razonSocial !== undefined) patch.razonSocial = b.razonSocial.trim();
  if (b.cuit !== undefined) {
    const c = normalizeCuit(b.cuit);
    if (c.length < 10) {
      return NextResponse.json({ error: "CUIT inválido" }, { status: 400 });
    }
    patch.cuit = c;
  }
  if (b.ivaCondicion !== undefined) patch.ivaCondicion = b.ivaCondicion;
  if (b.domicilio !== undefined) patch.domicilio = b.domicilio.trim();
  if (b.emailFacturacion !== undefined) patch.emailFacturacion = b.emailFacturacion.trim().toLowerCase();
  if (b.mensualidadUsd !== undefined) patch.mensualidadUsd = b.mensualidadUsd;
  if (b.condicionVenta !== undefined) patch.condicionVenta = b.condicionVenta.trim() || "Transferencia bancaria";
  if (b.tipoComprobanteDefault !== undefined) patch.tipoComprobanteDefault = b.tipoComprobanteDefault;
  if (b.descripcionServicio !== undefined) patch.descripcionServicio = b.descripcionServicio.trim();

  try {
    await ref.update(patch);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[billing/clients PATCH]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const denied = await requireDashboard(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "id requerido" }, { status: 400 });
  }

  try {
    await db.collection(BILLING_CLIENTS_COLLECTION).doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[billing/clients DELETE]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
