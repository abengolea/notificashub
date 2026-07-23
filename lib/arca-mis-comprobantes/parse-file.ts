import * as XLSX from "xlsx";
import {
  detectKindFromHeaders,
  findHeaderRowIndex,
  mapHeaderIndex,
  parseMisComprobantesCsv,
  rowFromCells,
  type MisCbteKind,
  type MisComprobanteRow,
} from "@/lib/arca-mis-comprobantes/parse";

function sheetToRows(ws: XLSX.WorkSheet, kindHint?: MisCbteKind): {
  rows: MisComprobanteRow[];
  kind: MisCbteKind;
  warnings: string[];
} {
  const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1,
    defval: "",
    raw: true,
  }) as unknown[][];
  if (!matrix.length) return { rows: [], kind: kindHint ?? "recibido", warnings: ["Hoja vacía"] };

  const headerIdx = findHeaderRowIndex(matrix);
  const headers = (matrix[headerIdx] ?? []).map((h) => String(h ?? "").trim());
  const kind = kindHint ?? detectKindFromHeaders(headers);
  const col = mapHeaderIndex(headers, kind);
  const warnings: string[] = [];
  if (!col.has("fecha") || !col.has("numero")) {
    warnings.push("Columnas Fecha/Número no encontradas en la hoja");
  }
  if (headerIdx > 0) {
    warnings.push(`Encabezados detectados en fila ${headerIdx + 1}`);
  }
  const rows: MisComprobanteRow[] = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const row = rowFromCells(matrix[i] ?? [], col, kind);
    if (row) rows.push(row);
  }
  return { rows, kind, warnings };
}

/** Detecta kind por nombre de archivo. */
export function kindFromFilename(name: string): MisCbteKind | undefined {
  const n = name.toLowerCase();
  if (n.includes("emitid")) return "emitido";
  if (n.includes("recibid")) return "recibido";
  return undefined;
}

export function parseMisComprobantesBuffer(
  buf: Buffer,
  filename: string
): { rows: MisComprobanteRow[]; kind: MisCbteKind; warnings: string[] } {
  const kindHint = kindFromFilename(filename);
  const lower = filename.toLowerCase();

  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    return parseMisComprobantesCsv(buf.toString("utf8"), kindHint);
  }

  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { rows: [], kind: kindHint ?? "recibido", warnings: ["Sin hojas"] };
  return sheetToRows(wb.Sheets[sheetName], kindHint);
}
