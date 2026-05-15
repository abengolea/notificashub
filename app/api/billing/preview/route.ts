import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase-admin";
import { requireDashboard } from "@/lib/require-dashboard";
import { BILLING_CLIENTS_COLLECTION } from "@/lib/billing/constants";
import { billingPreviewBodySchema } from "@/lib/billing/schemas";
import { fetchCotizacionDolarReferencia } from "@/lib/billing/exchange-rate";
import { montosDesdeUsdTipoCambio } from "@/lib/billing/calc";

export async function POST(req: NextRequest) {
  const denied = await requireDashboard(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = billingPreviewBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validación fallida", details: parsed.error.flatten() }, { status: 400 });
  }

  const { clientId, fecha, arsPorUsdManual } = parsed.data;

  try {
    const doc = await db.collection(BILLING_CLIENTS_COLLECTION).doc(clientId).get();
    if (!doc.exists) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }
    const c = doc.data()!;
    if (c.active === false) {
      return NextResponse.json({ error: "Cliente inactivo" }, { status: 400 });
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

    return NextResponse.json({
      fecha,
      cliente: {
        id: doc.id,
        razonSocial: c.razonSocial,
        cuit: c.cuit,
        tipoComprobanteDefault: tipo,
        mensualidadUsd: usd,
        emailFacturacion: c.emailFacturacion,
        descripcionServicio: c.descripcionServicio ?? "",
      },
      cotizacion,
      arsPorUsdUsado: arsPorUsd,
      fuenteTipoCambio:
        cotizacion?.fuente ??
        (arsPorUsdManual != null ? "Tipo de cambio ingresado manualmente (ej. BNA vendedor del día)" : ""),
      cotizacionFechaISO: cotizacion?.fechaActualizacionISO ?? null,
      ...montos,
    });
  } catch (e) {
    console.error("[billing/preview POST]", e);
    const msg = e instanceof Error ? e.message : "Error en preview";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
