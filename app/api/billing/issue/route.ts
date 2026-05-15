import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { requireDashboard } from "@/lib/require-dashboard";
import { ACCOUNTING_COLLECTIONS } from "@/lib/accounting/constants";
import { BILLING_CLIENTS_COLLECTION, BILLING_DEFAULT_PUNTO_VENTA } from "@/lib/billing/constants";
import { billingIssueBodySchema } from "@/lib/billing/schemas";
import { fetchCotizacionDolarReferencia } from "@/lib/billing/exchange-rate";
import {
  billingRecurrenteKey,
  buildObservacionesRecurrente,
  montosDesdeUsdTipoCambio,
} from "@/lib/billing/calc";
import { dateOnlyToUtcMidday } from "@/lib/accounting/dates";
import { enviarMailFacturaRecurrente } from "@/lib/billing/email";

export async function POST(req: NextRequest) {
  const denied = await requireDashboard(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = billingIssueBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validación fallida", details: parsed.error.flatten() }, { status: 400 });
  }

  const { clientId, fecha, numero, puntoVenta, arsPorUsdManual, enviarEmail } = parsed.data;
  const pv =
    (puntoVenta?.trim() || process.env.BILLING_DEFAULT_PUNTO_VENTA?.trim() || BILLING_DEFAULT_PUNTO_VENTA).padStart(
      5,
      "0",
    );

  try {
    const doc = await db.collection(BILLING_CLIENTS_COLLECTION).doc(clientId).get();
    if (!doc.exists) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }
    const c = doc.data()!;
    if (c.active === false) {
      return NextResponse.json({ error: "Cliente inactivo" }, { status: 400 });
    }

    const fd = dateOnlyToUtcMidday(fecha);
    const year = fd.getUTCFullYear();
    const month = fd.getUTCMonth() + 1;
    const brKey = billingRecurrenteKey(clientId, year, month);

    const dup = await db
      .collection(ACCOUNTING_COLLECTIONS.facturas)
      .where("billingRecurrenteKey", "==", brKey)
      .limit(1)
      .get();
    if (!dup.empty) {
      return NextResponse.json(
        {
          error: "Ya existe una factura recurrente para este cliente y mes.",
          facturaId: dup.docs[0].id,
        },
        { status: 409 },
      );
    }

    let cotizacion: Awaited<ReturnType<typeof fetchCotizacionDolarReferencia>> | null = null;
    let arsPorUsd = arsPorUsdManual;
    if (arsPorUsd == null) {
      cotizacion = await fetchCotizacionDolarReferencia();
      arsPorUsd = cotizacion.venta;
    }

    const tipo = (c.tipoComprobanteDefault ?? "A") as "A" | "B" | "C";
    const usd = typeof c.mensualidadUsd === "number" ? c.mensualidadUsd : 150;
    const montos = montosDesdeUsdTipoCambio(usd, arsPorUsd, tipo);

    const fuenteTipoCambio =
      cotizacion?.fuente ??
      (arsPorUsdManual != null ? "Tipo de cambio manual (referencia BNA vendedor u otra fuente acordada)" : "");

    const observaciones = buildObservacionesRecurrente({
      conceptoLinea: (c.descripcionServicio as string)?.trim() || "Servicio mensual conforme contrato.",
      tipoComprobante: tipo,
      usd,
      arsPorUsd,
      netoGravado: montos.netoGravado,
      fuenteTipoCambio,
      billingKey: brKey,
    });

    const fechaTs = Timestamp.fromDate(fd);
    const facturaRef = await db.collection(ACCOUNTING_COLLECTIONS.facturas).add({
      empresa: "notificas_srl",
      tipo: "venta",
      numero: numero.trim(),
      puntoVenta: pv,
      fecha: fechaTs,
      razonsocial: String(c.razonSocial ?? "").trim(),
      cuit: String(c.cuit ?? "").replace(/\D/g, "") || null,
      tipoComprobante: tipo,
      netoGravado: montos.netoGravado,
      iva: montos.iva,
      otrosImpuestos: 0,
      total: montos.total,
      observaciones,
      billingRecurrenteKey: brKey,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    let emailResult: { ok: true } | { ok: false; error: string } | null = null;
    if (enviarEmail) {
      const to = String(c.emailFacturacion ?? "").trim();
      if (!to) {
        emailResult = { ok: false, error: "El cliente no tiene email de facturación" };
      } else {
        emailResult = await enviarMailFacturaRecurrente({
          to,
          clienteNombre: String(c.razonSocial ?? ""),
          fechaISO: fecha,
          numeroComprobante: numero.trim(),
          puntoVenta: pv,
          neto: montos.netoGravado,
          iva: montos.iva,
          total: montos.total,
          observaciones,
        });
      }
    }

    return NextResponse.json({
      facturaId: facturaRef.id,
      billingRecurrenteKey: brKey,
      arsPorUsdUsado: arsPorUsd,
      netoGravado: montos.netoGravado,
      iva: montos.iva,
      total: montos.total,
      email: emailResult,
    });
  } catch (e) {
    console.error("[billing/issue POST]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
