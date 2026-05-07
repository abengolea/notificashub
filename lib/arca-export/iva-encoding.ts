/**
 * Codificación de campos Libro de IVA Digital según layouts oficiales (AFIP/ARCA).
 * Archivos resultado: ANSI (latin1).
 */

/** 15 dígitos: importe × 100, sin coma, empardado en ceros. */
export function monto15(importe: number): string {
  const c = Math.round(importe * 100);
  if (!Number.isFinite(c)) throw new Error("Importe inválido");
  if (c < 0) throw new Error("Los importes para este export deben ser no negativos (usá tipo NC con montos positivos)");
  const s = String(c);
  if (s.length > 15) throw new Error("Importe demasiado grande para 15 dígitos");
  return s.padStart(15, "0");
}

/** 10 dígitos: 4 enteros + 6 decimales sin punto; 1 peso = 0001000000 */
export function tipoCambioPesos(): string {
  return "0001000000";
}

export function yyyymmddFromIsoUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error("Fecha ISO inválida");
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${mo}${day}`;
}

export function onlyDigits(input: string | undefined): string {
  return (input ?? "").replace(/\D/g, "");
}

/** Código IVA tabla alícuotas (0003 … 0009). Inferido por proporción neto/IVA. */
export function inferirCodigoAlicuota(netoGravado: number, iva: number): string {
  if (netoGravado <= 0 || iva <= 0) return "0005";
  const tasa = ((iva / netoGravado) * 1000) / 10;
  if (Math.abs(tasa - 21) <= 0.25) return "0005";
  if (Math.abs(tasa - 10.5) <= 0.25) return "0004";
  if (Math.abs(tasa - 27) <= 0.35) return "0006";
  if (Math.abs(tasa - 5) <= 0.25) return "0008";
  if (Math.abs(tasa - 2.5) <= 0.25) return "0009";
  return "0005";
}

export function fixedNumeric(value: string, len: number, fill = "0"): string {
  const v = (value ?? "").slice(0, len);
  if (fill === "0") return v.padStart(len, "0");
  return v.padEnd(len, fill).slice(0, len);
}

/** Alfanumérico: truncar/pad hasta len; texto seguro latin1 típico (sin ñ especial → N). */
export function fixedAlpha(original: string, len: number): string {
  const u = original
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/Ñ/g, "N");

  let out = "";
  for (const ch of Array.from(u)) {
    const c = ch.charCodeAt(0);
    if (c >= 32 && c <= 126) {
      out += ch;
    } else if (c <= 255) {
      out += "?";
    }
    if (out.length >= len) break;
  }
  return out.slice(0, len).padEnd(len, " ");
}

export function mapTipoVentasCodigo(tc: string | undefined, esNc: boolean): string {
  const t = (tc ?? "").toLowerCase();
  if (esNc || t.startsWith("credito")) {
    if (t === "credito_b" || t === "b") return "008";
    if (t === "credito_c" || t === "c") return "013";
    return "003";
  }
  if (t === "b" || t.includes("fec_b")) return "006";
  if (t === "c" || t.includes("fec_c")) return "011";
  if (t === "201" || t === "fce_a") return "201";
  if (t === "206" || t === "fce_b") return "206";
  if (t === "211" || t === "fce_c") return "211";
  return "001";
}

export function mapTipoComprasCodigo(tc: string | undefined, esNc: boolean): string {
  const t = (tc ?? "").toLowerCase();
  if (esNc || t.startsWith("credito")) {
    if (t === "credito_b" || t === "b") return "008";
    if (t === "credito_c" || t === "c") return "013";
    return "003";
  }
  if (t === "b" || t.includes("fec_b")) return "006";
  if (t === "c" || t.includes("fec_c")) return "011";
  if (t === "201" || t === "fce_a") return "201";
  if (t === "206" || t === "fce_b") return "206";
  if (t === "211" || t === "fce_c") return "211";
  return "001";
}

export function sugiereTipoComprobantePorMontosGravados(neto: number, iva: number): "A" | "B" | "C" {
  if (neto <= 0 && iva <= 0) return "C";
  if (iva > 0) return "A";
  return "C";
}
