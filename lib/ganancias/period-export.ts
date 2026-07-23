import { Timestamp } from "firebase-admin/firestore";
import * as XLSX from "xlsx";
import { db } from "@/lib/firebase-admin";
import {
  DEFAULT_ACCOUNTING_ENTITY_ID,
  getAccountingEntity,
  type AccountingEntityId,
} from "@/lib/accounting/entities";
import { yearBoundsUtc } from "@/lib/accounting/dates";
import { facturasFirestoreToNormalized, type FactFirestoreLike } from "@/lib/arca-export/iva-lines";
import { pagoDocToRecord } from "@/lib/accounting/pago-persist";
import { pagoEffectiveInvoiceDate } from "@/lib/accounting/iva-compras-export";
import { gastoBaseImponible } from "@/lib/sifere-cm05/aggregate";
import type { AccountingCategory } from "@/lib/accounting/pago-fiscal";
import type { DeduccionCategoria } from "@/lib/accounting/schemas";
import { computeGananciasYear, type GananciasYearSummary } from "@/lib/ganancias/aggregate";
import { DEDUCCION_CATEGORIA_LABELS } from "@/lib/ganancias/constants";

export type DeduccionRecord = {
  id: string;
  year: number;
  categoria: DeduccionCategoria;
  descripcion: string;
  importe: number;
  /** YYYY-MM-DD opcional; si falta, se asigna a diciembre para no perderla del total anual. */
  fecha: string | null;
  notes: string;
};

function monthFromYmd(ymd: string | null): number {
  if (ymd && /^\d{4}-\d{2}-\d{2}$/.test(ymd)) return parseInt(ymd.slice(5, 7), 10);
  return 12;
}

export type GananciasYearData = GananciasYearSummary & {
  entityId: AccountingEntityId;
  entityDisplayName: string;
  deducciones: DeduccionRecord[];
};

/** Carga facturas de venta (devengado) + gastos deducibles + deducciones personales del año y arma el resumen mensual. */
export async function loadGananciasYear(input: {
  year: number;
  entityId?: AccountingEntityId;
}): Promise<GananciasYearData> {
  const entity = getAccountingEntity(input.entityId ?? DEFAULT_ACCOUNTING_ENTITY_ID);
  const { start, end } = yearBoundsUtc(input.year);
  const startTs = Timestamp.fromDate(start);
  const endTs = Timestamp.fromDate(end);

  const [factSnap, pagSnap, dedSnap] = await Promise.all([
    db
      .collection(entity.collections.facturas)
      .where("fecha", ">=", startTs)
      .where("fecha", "<=", endTs)
      .limit(6000)
      .get(),
    db
      .collection(entity.collections.pagos)
      .where("fecha", ">=", startTs)
      .where("fecha", "<=", endTs)
      .limit(6000)
      .get(),
    entity.isIndividual
      ? db.collection(entity.collections.deducciones).where("year", "==", input.year).limit(2000).get()
      : null,
  ]);

  const facts = facturasFirestoreToNormalized(
    factSnap.docs.map((d) => ({ id: d.id, data: () => d.data() as FactFirestoreLike }))
  );
  const ventas = facts
    .filter((f) => f.tipo === "venta")
    .map((f) => ({ month: new Date(f.fechaIso).getUTCMonth() + 1, netoGravado: f.netoGravado }));

  const gastos = pagSnap.docs
    .map((doc) => pagoDocToRecord(doc.id, doc.data()))
    .filter((rec) => rec.isIncomeTaxDeductible)
    .map((rec) => ({
      month: monthFromYmd(pagoEffectiveInvoiceDate(rec)),
      amount: gastoBaseImponible(rec),
      accountingCategory: rec.accountingCategory,
    }));

  const deducciones: DeduccionRecord[] = (dedSnap?.docs ?? []).map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      year: Number(d.year) || input.year,
      categoria: (d.categoria as DeduccionCategoria) ?? "otro",
      descripcion: String(d.descripcion ?? ""),
      importe: Number(d.importe) || 0,
      fecha: typeof d.fecha === "string" ? d.fecha : null,
      notes: String(d.notes ?? ""),
    };
  });

  const summary = computeGananciasYear({
    year: input.year,
    ventas,
    gastos,
    deducciones: deducciones.map((d) => ({
      month: monthFromYmd(d.fecha),
      categoria: d.categoria,
      importe: d.importe,
    })),
  });

  return { ...summary, entityId: entity.id, entityDisplayName: entity.displayName, deducciones };
}

export type GananciasXlsxResult = { buffer: Buffer; filename: string; contentType: string };

/** Genera un .xlsx (workbook nuevo, sin plantilla oficial) con el resumen anual de Ganancias. */
export function buildGananciasXlsx(data: GananciasYearData): GananciasXlsxResult {
  const header = ["Concepto", ...data.months.map((m) => m.label), "Total"];
  const rows: (string | number)[][] = [header];

  rows.push(["Ingreso bruto (devengado)", ...data.months.map((m) => m.ingresoBruto), data.totalIngresoBruto]);

  const categorias = new Set<AccountingCategory>();
  for (const m of data.months) {
    for (const cat of Object.keys(m.gastosPorCategoria) as AccountingCategory[]) categorias.add(cat);
  }
  for (const cat of Array.from(categorias).sort()) {
    const perMonth = data.months.map((m) => m.gastosPorCategoria[cat] ?? 0);
    const total = perMonth.reduce((a, b) => a + b, 0);
    rows.push([`Gasto deducible · ${cat}`, ...perMonth, total]);
  }

  rows.push([
    "Total gastos deducibles",
    ...data.months.map((m) => m.totalGastosDeducibles),
    data.totalGastosDeducibles,
  ]);

  if (data.deducciones.length > 0) {
    rows.push([
      "Deducciones personales",
      ...data.months.map((m) => m.deduccionesPersonales),
      data.totalDeduccionesPersonales,
    ]);
  }

  rows.push(["Resultado neto estimado", ...data.months.map((m) => m.resultadoNeto), data.totalResultadoNeto]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Resumen anual");

  if (data.deducciones.length > 0) {
    const dedRows: (string | number)[][] = [["Fecha", "Categoría", "Descripción", "Importe", "Notas"]];
    for (const d of data.deducciones) {
      dedRows.push([
        d.fecha ?? "",
        DEDUCCION_CATEGORIA_LABELS[d.categoria] ?? d.categoria,
        d.descripcion,
        d.importe,
        d.notes,
      ]);
    }
    const wsDed = XLSX.utils.aoa_to_sheet(dedRows);
    XLSX.utils.book_append_sheet(wb, wsDed, "Deducciones personales");
  }

  const buffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  const filename = `Ganancias_resumen_${data.entityId}_${data.year}.xlsx`;

  return {
    buffer,
    filename,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}
