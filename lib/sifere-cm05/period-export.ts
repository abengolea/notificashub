import { Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import {
  DEFAULT_ACCOUNTING_ENTITY_ID,
  getAccountingEntity,
  type AccountingEntityId,
} from "@/lib/accounting/constants";
import { pagoDocToRecord } from "@/lib/accounting/pago-persist";
import { pagoEffectiveInvoiceDate } from "@/lib/accounting/iva-compras-export";
import {
  facturasFirestoreToNormalized,
  type FactFirestoreLike,
} from "@/lib/arca-export/iva-lines";
import {
  aggregateCm05Period,
  gastoBaseImponible,
  type Cm05AggregateResult,
} from "@/lib/sifere-cm05/aggregate";
import { buildCm05XlsBuffer, type BuildCm05XlsResult } from "@/lib/sifere-cm05/build-xls";
import {
  CM05_DEFAULT_JURISDICCION,
  type Cm05JurisdiccionCode,
} from "@/lib/sifere-cm05/jurisdictions";

function bounds(year: number, month: number): { start: Timestamp; end: Timestamp } {
  const startD = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const endD = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { start: Timestamp.fromDate(startD), end: Timestamp.fromDate(endD) };
}

function inPeriodYmd(ymd: string | null, year: number, month: number): boolean {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [y, m] = ymd.split("-").map((x) => parseInt(x, 10));
  return y === year && m === month;
}

export type Cm05PeriodExport = BuildCm05XlsResult & {
  summary: Cm05AggregateResult & {
    year: number;
    month: number;
    jurisdiccion: Cm05JurisdiccionCode;
    cuit: string;
    razonSocial: string;
  };
};

/** Carga ventas/gastos del mes y arma el .xls CM05 para SIFERE/ARCA. */
export async function exportCm05Period(input: {
  year: number;
  month: number;
  jurisdiccion?: Cm05JurisdiccionCode;
  entityId?: AccountingEntityId;
}): Promise<Cm05PeriodExport> {
  const year = input.year;
  const month = input.month;
  const entity = getAccountingEntity(input.entityId ?? DEFAULT_ACCOUNTING_ENTITY_ID);
  const jurisdiccion = input.jurisdiccion ?? CM05_DEFAULT_JURISDICCION;
  const { start, end } = bounds(year, month);

  const [factSnap, pagSnap] = await Promise.all([
    db
      .collection(entity.collections.facturas)
      .where("fecha", ">=", start)
      .where("fecha", "<=", end)
      .limit(4000)
      .get(),
    db
      .collection(entity.collections.pagos)
      .where("fecha", ">=", start)
      .where("fecha", "<=", end)
      .limit(4000)
      .get(),
  ]);

  const facts = facturasFirestoreToNormalized(
    factSnap.docs.map((d) => ({ id: d.id, data: () => d.data() as FactFirestoreLike }))
  );
  const ventas = facts
    .filter((f) => f.tipo === "venta")
    .map((f) => ({ netoGravado: f.netoGravado, tipoComprobante: f.tipoComprobante }));

  const gastos: {
    amount: number;
    accountingCategory: ReturnType<typeof pagoDocToRecord>["accountingCategory"];
  }[] = [];

  for (const doc of pagSnap.docs) {
    const rec = pagoDocToRecord(doc.id, doc.data());
    const eff = pagoEffectiveInvoiceDate(rec);
    if (!inPeriodYmd(eff, year, month)) continue;
    gastos.push({
      amount: gastoBaseImponible(rec),
      accountingCategory: rec.accountingCategory,
    });
  }

  // Ingresos = facturas venta; egresos = pagos (fuente fiscal clasificada).
  // No sumamos facturas compra aparte para no duplicar con pagos.

  const aggregated = aggregateCm05Period({ ventas, gastos, jurisdiccion });
  const cuit = entity.cuit || "00000000000";
  const razonSocial = entity.displayName;
  const file = buildCm05XlsBuffer({
    year,
    month,
    cuit,
    razonSocial,
    amounts: aggregated.amounts,
  });

  return {
    ...file,
    summary: {
      ...aggregated,
      year,
      month,
      jurisdiccion,
      cuit,
      razonSocial,
    },
  };
}
