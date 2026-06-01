import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { requireDashboard } from "@/lib/require-dashboard";
import { ACCOUNTING_COLLECTIONS } from "@/lib/accounting/constants";
import { facturasFirestoreToNormalized, type FactFirestoreLike } from "@/lib/arca-export/iva-lines";
import { buildIvaAuditReport } from "@/lib/accounting/iva-audit";

function bounds(year: number, month: number): { start: Timestamp; end: Timestamp } {
  const startD = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const endD = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { start: Timestamp.fromDate(startD), end: Timestamp.fromDate(endD) };
}

/** GET /api/accounting/iva-audit?year=2026&month=5 — diagnóstico IVA Compras del período. */
export async function GET(req: NextRequest) {
  const denied = await requireDashboard(req);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const y = parseInt(searchParams.get("year") ?? "", 10);
  const m = parseInt(searchParams.get("month") ?? "", 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return NextResponse.json({ error: "Query year y month requeridos (1-12)" }, { status: 400 });
  }

  const { start, end } = bounds(y, m);

  try {
    const [pagSnap, factSnap] = await Promise.all([
      db
        .collection(ACCOUNTING_COLLECTIONS.pagos)
        .where("fecha", ">=", start)
        .where("fecha", "<=", end)
        .limit(5000)
        .get(),
      db
        .collection(ACCOUNTING_COLLECTIONS.facturas)
        .where("fecha", ">=", start)
        .where("fecha", "<=", end)
        .limit(5000)
        .get(),
    ]);

    const facturasNorm = facturasFirestoreToNormalized(
      factSnap.docs.map((d) => ({ id: d.id, data: () => d.data() as FactFirestoreLike }))
    );
    const facturasCompras = facturasNorm.filter((f) => f.tipo === "compra").length;

    const report = buildIvaAuditReport(
      pagSnap.docs.map((d) => ({ id: d.id, data: () => d.data() })),
      y,
      m,
      facturasCompras
    );

    return NextResponse.json({
      ...report,
      diagnosticoTexto: report.lineasTexto.join("\n"),
      causaRaiz:
        "Los gastos legacy se guardaron sin campos fiscales (invoiceType, isVatComputable, netTaxedAmount, vat21). " +
        "El exportador exige isVatComputable=true, Factura A, CUIT, PV, número e IVA discriminado. " +
        "La inferencia retroactiva reconstruye lo posible desde observaciones; CUIT/PV/número requieren edición manual o re-OCR del PDF.",
    });
  } catch (e) {
    console.error("[accounting/iva-audit GET]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
