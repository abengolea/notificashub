import * as XLSX from "xlsx";
import { db } from "@/lib/firebase-admin";
import {
  DEFAULT_ACCOUNTING_ENTITY_ID,
  getAccountingEntity,
  type AccountingEntityId,
} from "@/lib/accounting/entities";
import type { BienNaturaleza, BienTipo } from "@/lib/accounting/schemas";
import { computeBienesPersonalesYear, type BienesPersonalesYearSummary } from "@/lib/bienes-personales/aggregate";
import { BIEN_TIPO_LABELS } from "@/lib/bienes-personales/constants";

export type BienRecord = {
  id: string;
  year: number;
  naturaleza: BienNaturaleza;
  tipo: BienTipo;
  descripcion: string;
  valuacionFiscal: number;
  notes: string;
  pdfStoragePath: string;
};

export type BienesPersonalesYearData = BienesPersonalesYearSummary & {
  entityId: AccountingEntityId;
  entityDisplayName: string;
  bienes: BienRecord[];
};

/** Carga bienes/deudas cargados a mano para el año y arma el resumen de patrimonio. */
export async function loadBienesPersonalesYear(input: {
  year: number;
  entityId?: AccountingEntityId;
}): Promise<BienesPersonalesYearData> {
  const entity = getAccountingEntity(input.entityId ?? DEFAULT_ACCOUNTING_ENTITY_ID);

  const snap = await db
    .collection(entity.collections.bienes)
    .where("year", "==", input.year)
    .limit(2000)
    .get();

  const bienes: BienRecord[] = snap.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      year: Number(d.year) || input.year,
      naturaleza: d.naturaleza === "pasivo" ? "pasivo" : "activo",
      tipo: (d.tipo as BienTipo) ?? "otro",
      descripcion: String(d.descripcion ?? ""),
      valuacionFiscal: Number(d.valuacionFiscal) || 0,
      notes: String(d.notes ?? ""),
      pdfStoragePath: String(d.pdfStoragePath ?? ""),
    };
  });

  const summary = computeBienesPersonalesYear(bienes, input.year);

  return { ...summary, entityId: entity.id, entityDisplayName: entity.displayName, bienes };
}

export type BienesPersonalesXlsxResult = { buffer: Buffer; filename: string; contentType: string };

/** Genera un .xlsx (workbook nuevo, sin plantilla oficial) con el detalle de patrimonio del año. */
export function buildBienesPersonalesXlsx(data: BienesPersonalesYearData): BienesPersonalesXlsxResult {
  const detailRows: (string | number)[][] = [
    ["Naturaleza", "Tipo", "Descripción", "Valuación fiscal (ARS)", "Notas"],
  ];
  for (const b of data.bienes) {
    detailRows.push([
      b.naturaleza === "activo" ? "Activo" : "Pasivo",
      BIEN_TIPO_LABELS[b.tipo] ?? b.tipo,
      b.descripcion,
      b.valuacionFiscal,
      b.notes,
    ]);
  }

  const summaryRows: (string | number)[][] = [
    ["Concepto", "Valor ARS"],
    ["Total activos", data.totalActivos],
    ["Total pasivos", data.totalPasivos],
    ["Patrimonio neto", data.patrimonioNeto],
    ["Mínimo no imponible (referencia)", data.minimoNoImponible],
    ["Impuesto estimado — escala progresiva (orientativo, verificar con contador)", data.impuestoEstimado],
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), "Resumen");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detailRows), "Detalle bienes y deudas");

  const buffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  const filename = `BienesPersonales_${data.entityId}_${data.year}.xlsx`;

  return {
    buffer,
    filename,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}
