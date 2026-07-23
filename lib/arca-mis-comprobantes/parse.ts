/** Normaliza encabezados de Mis Comprobantes (CSV/XLS). */
export function normalizeHeader(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/%/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseArNumber(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  let s = String(raw ?? "").trim();
  if (!s) return 0;
  s = s.replace(/\s/g, "").replace(/\$/g, "");
  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Acepta dd/mm/yyyy, yyyy-mm-dd, Date, serial Excel. */
export function parseArDate(raw: unknown): string | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const utc = Date.UTC(1899, 11, 30) + Math.round(raw) * 86400000;
    const d = new Date(utc);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    return `${m[3]}-${mm}-${dd}`;
  }
  return null;
}

export type MisCbteKind = "emitido" | "recibido";

export type MisComprobanteRow = {
  kind: MisCbteKind;
  fecha: string;
  tipoCodigo: number;
  puntoVenta: string;
  numero: string;
  cae: string;
  contraparteCuit: string;
  contraparteNombre: string;
  netoGravado: number;
  netoNoGravado: number;
  opExentas: number;
  otrosTributos: number;
  iva: number;
  total: number;
  moneda: string;
  tipoCambio: number;
};

const TIPO_ALIASES: Record<string, keyof MisComprobanteRow | "skip"> = {
  fecha: "fecha",
  "fecha de emision": "fecha",
  "tipo de comprobante": "tipoCodigo",
  tipo: "tipoCodigo",
  "punto de venta": "puntoVenta",
  "numero desde": "numero",
  "nro desde": "numero",
  numero: "numero",
  "cod autorizacion": "cae",
  "codigo de autorizacion": "cae",
  cae: "cae",
  "nro doc receptor": "contraparteCuit",
  "nro doc emisor": "contraparteCuit",
  "numero de documento": "contraparteCuit",
  "denominacion receptor": "contraparteNombre",
  "denominacion emisor": "contraparteNombre",
  denominacion: "contraparteNombre",
  "imp neto gravado": "netoGravado",
  "importe neto gravado": "netoGravado",
  "neto gravado total": "netoGravado",
  "imp neto no gravado": "netoNoGravado",
  "neto no gravado": "netoNoGravado",
  "imp op exentas": "opExentas",
  "op exentas": "opExentas",
  "otros tributos": "otrosTributos",
  iva: "iva",
  "total iva": "iva",
  "imp total": "total",
  "importe total": "total",
  moneda: "moneda",
  "tipo cambio": "tipoCambio",
  "numero hasta": "skip",
  "tipo doc receptor": "skip",
  "tipo doc emisor": "skip",
  "tipo de documento": "skip",
};

/** Fila de encabezados reales (ARCA pone un título en la 1ª). */
export function findHeaderRowIndex(matrix: unknown[][]): number {
  const max = Math.min(matrix.length, 15);
  for (let i = 0; i < max; i++) {
    const cells = (matrix[i] ?? []).map((c) => normalizeHeader(String(c ?? "")));
    if (cells.includes("fecha") && (cells.includes("tipo") || cells.includes("tipo de comprobante"))) {
      return i;
    }
  }
  return 0;
}

export function detectKindFromHeaders(headers: string[]): MisCbteKind {
  const joined = headers.map(normalizeHeader).join("|");
  if (joined.includes("denominacion emisor") || joined.includes("nro doc emisor")) return "recibido";
  if (joined.includes("denominacion receptor") || joined.includes("nro doc receptor")) return "emitido";
  return "recibido";
}

export function extractTipoCodigo(raw: unknown): number {
  const s = String(raw ?? "").trim();
  const m = /^(\d+)/.exec(s);
  if (m) return parseInt(m[1], 10);
  const n = parseArNumber(s);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** Para recibidos prioriza Emisor; para emitidos, Receptor. */
export function mapHeaderIndex(
  headers: string[],
  kind: MisCbteKind
): Map<keyof MisComprobanteRow, number> {
  const map = new Map<keyof MisComprobanteRow, number>();
  const preferEmisor = kind === "recibido";

  headers.forEach((h, i) => {
    const norm = normalizeHeader(h);
    const key = TIPO_ALIASES[norm];
    if (!key || key === "skip") return;

    if (key === "contraparteCuit" || key === "contraparteNombre") {
      const isEmisor = norm.includes("emisor");
      const isReceptor = norm.includes("receptor");
      if (preferEmisor && isReceptor) return;
      if (!preferEmisor && isEmisor) return;
    }

    if (!map.has(key)) map.set(key, i);
  });
  return map;
}

export function rowFromCells(
  cells: unknown[],
  col: Map<keyof MisComprobanteRow, number>,
  kind: MisCbteKind
): MisComprobanteRow | null {
  const get = (k: keyof MisComprobanteRow) => {
    const i = col.get(k);
    return i == null ? undefined : cells[i];
  };
  const fecha = parseArDate(get("fecha"));
  if (!fecha) return null;
  const tipoCodigo = extractTipoCodigo(get("tipoCodigo"));
  const puntoVenta = String(get("puntoVenta") ?? "").replace(/\D/g, "") || "0";
  const numero = String(get("numero") ?? "").replace(/\D/g, "");
  if (!numero) return null;
  const total = parseArNumber(get("total"));
  const netoGravado = parseArNumber(get("netoGravado"));
  const iva = parseArNumber(get("iva"));
  return {
    kind,
    fecha,
    tipoCodigo,
    puntoVenta: puntoVenta.padStart(4, "0").slice(-5),
    numero,
    cae: String(get("cae") ?? "").replace(/\D/g, ""),
    contraparteCuit: String(get("contraparteCuit") ?? "").replace(/\D/g, "").slice(0, 11),
    contraparteNombre:
      String(get("contraparteNombre") ?? "").trim() || `CUIT ${get("contraparteCuit") ?? ""}`,
    netoGravado,
    netoNoGravado: parseArNumber(get("netoNoGravado")),
    opExentas: parseArNumber(get("opExentas")),
    otrosTributos: parseArNumber(get("otrosTributos")),
    iva,
    total: total || netoGravado + iva,
    moneda: String(get("moneda") ?? "PES").trim() || "PES",
    tipoCambio: parseArNumber(get("tipoCambio")) || 1,
  };
}

export function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQ = !inQ;
      continue;
    }
    if (ch === sep && !inQ) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

export function detectCsvSeparator(headerLine: string): "," | ";" {
  const commas = (headerLine.match(/,/g) ?? []).length;
  const semis = (headerLine.match(/;/g) ?? []).length;
  return semis > commas ? ";" : ",";
}

export function parseMisComprobantesCsv(
  text: string,
  kindHint?: MisCbteKind
): { rows: MisComprobanteRow[]; kind: MisCbteKind; warnings: string[] } {
  const warnings: string[] = [];
  const cleaned = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = cleaned.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { rows: [], kind: kindHint ?? "recibido", warnings: ["CSV vacío"] };

  const sep = detectCsvSeparator(lines[0]);
  const matrix = lines.map((l) => splitCsvLine(l, sep));
  const headerIdx = findHeaderRowIndex(matrix);
  const headers = (matrix[headerIdx] ?? []).map((h) => String(h ?? "").trim());
  const kind = kindHint ?? detectKindFromHeaders(headers);
  const col = mapHeaderIndex(headers, kind);
  if (!col.has("fecha") || !col.has("tipoCodigo") || !col.has("numero")) {
    warnings.push("No se reconocieron columnas obligatorias (Fecha / Tipo / Número)");
  }

  const rows: MisComprobanteRow[] = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const row = rowFromCells(matrix[i] ?? [], col, kind);
    if (row) rows.push(row);
  }
  return { rows, kind, warnings };
}
