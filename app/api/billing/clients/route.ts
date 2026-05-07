import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { requireDashboard } from "@/lib/require-dashboard";
import { BILLING_CLIENTS_COLLECTION } from "@/lib/billing/constants";
import { billingClientBodySchema } from "@/lib/billing/schemas";
import { toIso } from "@/lib/accounting/serialize";

function normalizeCuit(s: string): string {
  return s.replace(/\D/g, "").slice(0, 11);
}

export async function GET(req: NextRequest) {
  const denied = await requireDashboard(req);
  if (denied) return denied;

  try {
    const snap = await db
      .collection(BILLING_CLIENTS_COLLECTION)
      .orderBy("razonSocial")
      .limit(200)
      .get();

    const clients = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        active: d.active !== false,
        razonSocial: d.razonSocial ?? "",
        cuit: d.cuit ?? "",
        ivaCondicion: d.ivaCondicion ?? "no_categorizado",
        domicilio: d.domicilio ?? "",
        emailFacturacion: d.emailFacturacion ?? "",
        mensualidadUsd: typeof d.mensualidadUsd === "number" ? d.mensualidadUsd : 150,
        condicionVenta: d.condicionVenta ?? "Transferencia bancaria",
        tipoComprobanteDefault: d.tipoComprobanteDefault ?? "A",
        descripcionServicio:
          typeof d.descripcionServicio === "string"
            ? d.descripcionServicio
            : "Servicio mensual de plataforma / soporte conforme contrato.",
        createdAt: toIso(d.createdAt),
        updatedAt: toIso(d.updatedAt),
      };
    });

    return NextResponse.json({ clients });
  } catch (e) {
    console.error("[billing/clients GET]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireDashboard(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = billingClientBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validación fallida", details: parsed.error.flatten() }, { status: 400 });
  }

  const b = parsed.data;
  const cuit = normalizeCuit(b.cuit);
  if (cuit.length < 10) {
    return NextResponse.json({ error: "CUIT inválido" }, { status: 400 });
  }

  try {
    const ref = await db.collection(BILLING_CLIENTS_COLLECTION).add({
      active: b.active,
      razonSocial: b.razonSocial.trim(),
      cuit,
      ivaCondicion: b.ivaCondicion,
      domicilio: b.domicilio.trim(),
      emailFacturacion: b.emailFacturacion.trim().toLowerCase(),
      mensualidadUsd: b.mensualidadUsd,
      condicionVenta: b.condicionVenta?.trim() || "Transferencia bancaria",
      tipoComprobanteDefault: b.tipoComprobanteDefault,
      descripcionServicio: b.descripcionServicio.trim(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (e) {
    console.error("[billing/clients POST]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
