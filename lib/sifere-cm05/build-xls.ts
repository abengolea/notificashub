import * as fs from "node:fs";
import * as path from "node:path";
import * as XLSX from "xlsx";
import { BILLING_EMISOR } from "@/lib/billing/constants";
import {
  CM05_CODE_ROWS,
  CM05_LEAF_CODES,
  rollupCm05Column,
  type Cm05LeafCode,
} from "@/lib/sifere-cm05/codes";
import { getAmount, type Cm05AmountKey } from "@/lib/sifere-cm05/aggregate";
import {
  CM05_JURISDICCIONES,
  CM05_NO_COMPUTABLE_COL,
  type Cm05JurisdiccionCode,
} from "@/lib/sifere-cm05/jurisdictions";

export const CM05_SHEET_NAME = "GASTOS_INGRESOS";
export const CM05_TEMPLATE_RELATIVE = path.join("assets", "sifere", "modelo_carga_resumen_periodo.xls");

export type BuildCm05XlsInput = {
  year: number;
  month: number;
  cuit?: string;
  razonSocial?: string;
  amounts: Map<Cm05AmountKey, number>;
  templatePath?: string;
};

export type BuildCm05XlsResult = {
  buffer: Buffer;
  filename: string;
  contentType: string;
};

function resolveTemplatePath(override?: string): string {
  if (override) return override;
  return path.join(process.cwd(), CM05_TEMPLATE_RELATIVE);
}

function setNum(ws: XLSX.WorkSheet, addr: string, value: number): void {
  ws[addr] = { t: "n", v: value };
}

function setStr(ws: XLSX.WorkSheet, addr: string, value: string): void {
  ws[addr] = { t: "s", v: value };
}

/** Columnas de importes del modelo (NO COMPUTABLE + 24 jurisdicciones). */
function amountColumns(): { col: string; jur: Cm05JurisdiccionCode | "NO_COMPUTABLE" }[] {
  return [
    { col: CM05_NO_COMPUTABLE_COL, jur: "NO_COMPUTABLE" },
    ...CM05_JURISDICCIONES.map((j) => ({ col: j.col, jur: j.code as Cm05JurisdiccionCode })),
  ];
}

/**
 * Genera el .xls en el formato exacto del modelo ARCA/SIFERE (CM05).
 * Escribe importes en hojas hoja y recalcula totales padre (las fórmulas se pierden al serializar BIFF8).
 */
export function buildCm05XlsBuffer(input: BuildCm05XlsInput): BuildCm05XlsResult {
  const templatePath = resolveTemplatePath(input.templatePath);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Plantilla CM05 no encontrada: ${templatePath}`);
  }

  const wb = XLSX.read(fs.readFileSync(templatePath), {
    type: "buffer",
    cellFormula: true,
    cellStyles: true,
  });
  const ws = wb.Sheets[CM05_SHEET_NAME] ?? wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("Hoja GASTOS_INGRESOS no encontrada en la plantilla");

  const cuit = (input.cuit ?? BILLING_EMISOR.cuit).replace(/\D/g, "");
  const razon = input.razonSocial ?? BILLING_EMISOR.razonSocial;

  setStr(ws, "J1", cuit);
  setStr(ws, "J2", razon);
  setNum(ws, "J3", input.year);

  for (const { col, jur } of amountColumns()) {
    const rollup = rollupCm05Column((code) => {
      if (!(CM05_LEAF_CODES as readonly string[]).includes(code)) return 0;
      return getAmount(input.amounts, code as Cm05LeafCode, jur);
    });

    for (const [code, value] of Object.entries(rollup)) {
      const row = CM05_CODE_ROWS[code];
      if (!row) continue;
      setNum(ws, `${col}${row}`, value);
    }
  }

  const buffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "biff8" }));
  const mm = String(input.month).padStart(2, "0");
  const filename = `CM05_ingresos_gastos_${input.year}-${mm}.xls`;

  return {
    buffer,
    filename,
    contentType: "application/vnd.ms-excel",
  };
}
