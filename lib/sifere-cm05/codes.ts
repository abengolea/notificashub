import type { AccountingCategory } from "@/lib/accounting/pago-fiscal";

/**
 * Filas del modelo ARCA `modelo_carga_resumen_periodo.xls` (hoja GASTOS_INGRESOS).
 * row = fila Excel 1-based.
 */
export const CM05_CODE_ROWS: Record<string, number> = {
  "1000": 8,
  "1100": 9,
  "1101": 10,
  "1102": 11,
  "1103": 12,
  "1104": 13,
  "1105": 14,
  "1106": 15,
  "1200": 16,
  "1201": 17,
  "1202": 18,
  "1203": 19,
  "1204": 20,
  "1300": 21,
  "1301": 22,
  "1302": 23,
  "1303": 24,
  "1304": 25,
  "1305": 26,
  "1306": 27,
  "1307": 28,
  "1308": 29,
  "2000": 30,
  "2100": 31,
  "2101": 32,
  "2102": 33,
  "2103": 34,
  "2104": 35,
  "2200": 36,
  "2201": 37,
  "2202": 38,
  "2203": 39,
  "2204": 40,
  "2205": 41,
  "2206": 42,
  "2207": 43,
  "2208": 44,
  "2209": 45,
  "2210": 46,
  "2211": 47,
  "2212": 48,
  "2213": 49,
  "2214": 50,
  "2215": 51,
  "2216": 52,
  "2217": 53,
  "2218": 54,
  "2219": 55,
  "2220": 56,
  "2221": 57,
  "2222": 58,
  "2223": 59,
  "2224": 60,
  "2225": 61,
  "2226": 62,
};

/** Celdas hoja donde solo se escribe valor (sin fórmula en el modelo). */
export const CM05_LEAF_CODES = [
  "1101",
  "1102",
  "1103",
  "1104",
  "1105",
  "1106",
  "1201",
  "1202",
  "1203",
  "1204",
  "1301",
  "1302",
  "1303",
  "1304",
  "1305",
  "1306",
  "1307",
  "1308",
  "2101",
  "2102",
  "2103",
  "2104",
  "2201",
  "2202",
  "2203",
  "2204",
  "2205",
  "2206",
  "2207",
  "2208",
  "2209",
  "2210",
  "2211",
  "2212",
  "2213",
  "2214",
  "2215",
  "2216",
  "2217",
  "2218",
  "2219",
  "2220",
  "2221",
  "2222",
  "2223",
  "2224",
  "2225",
  "2226",
] as const;

export type Cm05LeafCode = (typeof CM05_LEAF_CODES)[number];

/** Ingresos por servicios SaaS / plataforma. */
export const CM05_INGRESOS_SERVICIOS_CODE: Cm05LeafCode = "1106";

/**
 * Mapeo categorías contables hub → códigos hoja CM05.
 * Los aportes/reintegros de socio no entran al cuadro (null).
 */
export const CATEGORY_TO_CM05: Record<AccountingCategory, Cm05LeafCode | null> = {
  insumos: "2102",
  servicios: "2210",
  honorarios: "2207",
  alquiler: "2214",
  sueldos: "2202",
  impuestos: "2212",
  equipamiento: "2220",
  marketing: "2211",
  aporte_reintegro_socio: null,
  otro: "2226",
};

/** Recalcula totales padre como en el modelo (tras perder fórmulas al escribir .xls). */
export function rollupCm05Column(get: (code: string) => number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const code of CM05_LEAF_CODES) {
    out[code] = round2(get(code));
  }
  out["1100"] = round2(sumCodes(out, ["1101", "1102", "1103", "1104", "1105", "1106"]));
  out["1200"] = round2(sumCodes(out, ["1201", "1202", "1203", "1204"]));
  out["1300"] = round2(sumCodes(out, ["1301", "1302", "1303", "1304", "1305", "1306", "1307", "1308"]));
  out["1000"] = round2(out["1100"] + out["1200"] + out["1300"]);
  out["2100"] = round2(sumCodes(out, ["2101", "2102", "2103", "2104"]));
  out["2200"] = round2(
    sumCodes(out, [
      "2201",
      "2202",
      "2203",
      "2204",
      "2205",
      "2206",
      "2207",
      "2208",
      "2209",
      "2210",
      "2211",
      "2212",
      "2213",
      "2214",
      "2215",
      "2216",
      "2217",
      "2218",
      "2219",
      "2220",
      "2221",
      "2222",
      "2223",
      "2224",
      "2225",
      "2226",
    ])
  );
  out["2000"] = round2(out["2100"] + out["2200"]);
  return out;
}

function sumCodes(map: Record<string, number>, codes: string[]): number {
  return codes.reduce((acc, c) => acc + (map[c] ?? 0), 0);
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
