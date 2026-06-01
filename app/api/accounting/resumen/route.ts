import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { requireDashboard } from "@/lib/require-dashboard";
import { ACCOUNTING_COMPANY_NAME, ACCOUNTING_COLLECTIONS } from "@/lib/accounting/constants";
import { buildIvaAuditReport, pagosComprasForPeriodWithFallback } from "@/lib/accounting/iva-audit";

function bounds(year: number, month: number): { start: Timestamp; end: Timestamp } {
  const startD = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const endD = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { start: Timestamp.fromDate(startD), end: Timestamp.fromDate(endD) };
}

/** IVA técnico: débitos (ventas) y créditos (compras) según libro propio cargado en la app */
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
    const [factSnap, cobSnap, pagSnap] = await Promise.all([
      db
        .collection(ACCOUNTING_COLLECTIONS.facturas)
        .where("fecha", ">=", start)
        .where("fecha", "<=", end)
        .limit(5000)
        .get(),
      db
        .collection(ACCOUNTING_COLLECTIONS.cobros)
        .where("fecha", ">=", start)
        .where("fecha", "<=", end)
        .limit(5000)
        .get(),
      db
        .collection(ACCOUNTING_COLLECTIONS.pagos)
        .where("fecha", ">=", start)
        .where("fecha", "<=", end)
        .limit(5000)
        .get(),
    ]);

    let ventasNeto = 0;
    let ventasIva = 0;
    let ventasTotal = 0;
    let comprasNeto = 0;
    let comprasIva = 0;
    let comprasTotal = 0;

    for (const doc of factSnap.docs) {
      const d = doc.data();
      const tipo = d.tipo as string | undefined;
      const net = Number(d.netoGravado) || 0;
      const iva = Number(d.iva) || 0;
      const total = Number(d.total) || 0;
      if (tipo === "venta") {
        ventasNeto += net;
        ventasIva += iva;
        ventasTotal += total;
      } else if (tipo === "compra") {
        comprasNeto += net;
        comprasIva += iva;
        comprasTotal += total;
      }
    }

    let cobrosSum = 0;
    for (const doc of cobSnap.docs) {
      cobrosSum += Number(doc.data().importe) || 0;
    }
    let pagosSum = 0;
    for (const doc of pagSnap.docs) {
      pagosSum += Number(doc.data().totalAmount ?? doc.data().importe) || 0;
    }

    const pagosDocs = pagSnap.docs.map((d) => ({ id: d.id, data: () => d.data() }));
    const pagosIva = pagosComprasForPeriodWithFallback(pagosDocs, y, m);
    const auditReport = buildIvaAuditReport(pagosDocs, y, m);

    const comprasNetoTotal = comprasNeto + pagosIva.netoGravado;
    const comprasIvaTotal = comprasIva + pagosIva.ivaCredito21 + pagosIva.ivaCredito105 + pagosIva.ivaCredito27;
    const comprasTotalSum =
      comprasTotal + pagosIva.netoGravado + pagosIva.ivaCredito21 + pagosIva.ivaCredito105 + pagosIva.ivaCredito27;

    const ivaSaldoOrientativo = ventasIva - comprasIvaTotal;
    const resultadoCajaOrientativo = cobrosSum - pagosSum;

    return NextResponse.json({
      empresaNombre: ACCOUNTING_COMPANY_NAME,
      periodo: { year: y, month: m },
      libroFacturasCargadas: factSnap.docs.length,
      cobrosRegistrados: cobSnap.docs.length,
      pagosRegistrados: pagSnap.docs.length,
      iva: {
        debitoVentas: { netoGravado: ventasNeto, iva: ventasIva, totalFacturado: ventasTotal },
        creditoCompras: {
          netoGravado: comprasNetoTotal,
          iva: comprasIvaTotal,
          totalFacturado: comprasTotalSum,
          desdeFacturas: { netoGravado: comprasNeto, iva: comprasIva, count: factSnap.docs.filter((d) => d.data().tipo === "compra").length },
          desdePagosGastos: auditReport.resumen,
        },
        auditoriaIva: auditReport.resumen,
        diferenciaIVAOrientativa: ivaSaldoOrientativo,
      },
      tesoreria: {
        cobrosTotales: cobrosSum,
        pagosTotales: pagosSum,
        resultadoCajaOrientativo,
      },
      avisoLegal:
        "Cifras internas cargadas manualmente en NotificasHub. No sustituyen asiento contable, ni presentación ante ARCA. Verificá con tu estudio impositivo antes de cualquier declaración jurada.",
    });
  } catch (e) {
    console.error("[accounting/resumen GET]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
