/**
 * Ensambla líneas fijas Libro IVA Digital (archivos .txt ANSI importables — IVA Simple / registración electrónica).
 * Longitudes: Ventas CBTE 266, Ventas Alic 62, Compras CBTE 325, Compras Alic 84 (Anexo I AFIP).
 */
import type { Timestamp } from "firebase-admin/firestore";
import {
  fixedAlpha,
  fixedNumeric,
  inferirCodigoAlicuota,
  mapTipoComprasCodigo,
  mapTipoVentasCodigo,
  monto15,
  onlyDigits,
  sugiereTipoComprobantePorMontosGravados,
  tipoCambioPesos,
  yyyymmddFromIsoUtc,
} from "@/lib/arca-export/iva-encoding";

export type FactFirestoreLike = {
  fecha: Timestamp | Date | { toDate?: () => Date };
  tipo: string;
  numero: string;
  puntoVenta?: string | null;
  razonsocial?: string | null;
  cuit?: string | null;
  tipoComprobante?: string | null;
  netoGravado: number;
  iva: number;
  otrosImpuestos?: number | null;
  total: number;
};

function fechaIsoUtcFromDoc(val: FactFirestoreLike["fecha"]): string {
  let d: Date;
  if (val instanceof Date) d = val;
  else if (typeof (val as Timestamp).toDate === "function") d = (val as Timestamp).toDate();
  else if (typeof (val as { toDate?: () => Date }).toDate === "function")
    d = (val as { toDate: () => Date }).toDate();
  else throw new Error("fecha inválida en factura");
  return d.toISOString();
}

export type NormalizedFact = {
  id: string;
  fechaIso: string;
  tipo: "venta" | "compra";
  numero: string;
  puntoVenta: string;
  razonsocial: string;
  cuit: string;
  tipoComprobante: string;
  netoGravado: number;
  iva: number;
  otrosImpuestos: number;
  total: number;
};

function toRows(docs: { id: string; data: () => FactFirestoreLike }[]): NormalizedFact[] {
  return docs.map((doc) => {
    const x = doc.data();
    return {
      id: doc.id,
      fechaIso: fechaIsoUtcFromDoc(x.fecha),
      tipo: x.tipo === "compra" ? "compra" : ("venta" as const),
      numero: String(x.numero ?? "").trim(),
      puntoVenta: String(x.puntoVenta ?? "").trim() || "0",
      razonsocial: String(x.razonsocial ?? "NO INFORMADO").trim(),
      cuit: x.cuit ? String(x.cuit).trim() : "",
      tipoComprobante: x.tipoComprobante ? String(x.tipoComprobante).trim().toLowerCase() : "",
      netoGravado: Number(x.netoGravado) || 0,
      iva: Number(x.iva) || 0,
      otrosImpuestos: Number(x.otrosImpuestos) || 0,
      total: Number(x.total) || 0,
    };
  });
}

export function facturasFirestoreToNormalized(
  docs: { id: string; data: () => FactFirestoreLike }[]
): NormalizedFact[] {
  return toRows(docs).sort((a, b) => a.fechaIso.localeCompare(b.fechaIso));
}

function assertExactLen(tag: string, line: string, len: number) {
  if (line.length !== len) {
    throw new Error(`[LibroIVA ${tag}] longitud=${line.length} esperada=${len}`);
  }
}

function resolverLetraComprob(tcRaw: string, neto: number, iva: number): "A" | "B" | "C" {
  const tl = tcRaw;
  if (tl.includes("fec_a") || tl === "201" || tl === "fce_a") return "A";
  if (tl.includes("fec_b") || tl === "206" || tl === "fce_b") return "B";
  if (tl.includes("fec_c") || tl === "211" || tl === "fce_c") return "C";
  if (tl === "a" || tl.startsWith("credito_a")) return "A";
  if (tl === "b" || tl.startsWith("credito_b")) return "B";
  if (tl === "c" || tl.startsWith("credito_c")) return "C";
  if (tl === "otro") return sugiereTipoComprobantePorMontosGravados(neto, iva);
  if (!tl) return sugiereTipoComprobantePorMontosGravados(neto, iva);
  return sugiereTipoComprobantePorMontosGravados(neto, iva);
}

function esNotaCredito(tcRaw: string): boolean {
  return tcRaw.startsWith("credito");
}

function tipoComprobMapKey(letra: "A" | "B" | "C", nc: boolean): string {
  if (nc) return `credito_${letra.toLowerCase()}`;
  return letra.toLowerCase();
}

/** Comprador (ventas) / vendedor (compras). */
function docCodigoYLlaveIdent(cuitStr: string): { cod: string; id20: string } {
  const d = onlyDigits(cuitStr);
  if (d.length === 11) return { cod: "80", id20: fixedNumeric(d, 20) };
  if (d.length >= 7 && d.length <= 8) return { cod: "96", id20: fixedNumeric(d, 20) };
  return { cod: "99", id20: fixedNumeric("", 20) };
}

function tpv5(puntoVenta: string): string {
  const n = parseInt(String(puntoVenta).replace(/\D/g, "") || "0", 10);
  const v = Number.isFinite(n) && n >= 0 ? Math.min(n, 99999) : 0;
  return fixedNumeric(String(v), 5);
}

function nroCbte20(numeroStr: string): string {
  const n = parseInt(String(numeroStr).replace(/\D/g, "") || "0", 10);
  return fixedNumeric(String(Math.min(Math.max(n, 0), 99999999999999999999)), 20);
}

export function lineaVentasCabecera(f: NormalizedFact): string {
  const letra = resolverLetraComprob(f.tipoComprobante, f.netoGravado, f.iva);
  const nc = esNotaCredito(f.tipoComprobante);
  const tipoCod = fixedNumeric(mapTipoVentasCodigo(tipoComprobMapKey(letra, nc), nc), 3);
  const fecha = yyyymmddFromIsoUtc(f.fechaIso);
  const { cod: docCod, id20 } = docCodigoYLlaveIdent(f.cuit);
  const denom = fixedAlpha(f.razonsocial, 30);
  const cantAli =
    letra === "A" && f.netoGravado > 0 && f.iva > 0 ? "1" : "0";
  const percepNacion = monto15(f.otrosImpuestos);
  /** Exento: en export simple queda discriminado sólo como total operación (no duplicamos en campo exentas). */
  const exVentas = monto15(0);

  const line =
    fecha +
    tipoCod +
    tpv5(f.puntoVenta) +
    nroCbte20(f.numero) +
    nroCbte20(f.numero) +
    docCod +
    id20 +
    denom +
    monto15(f.total) +
    monto15(0) +
    monto15(0) +
    exVentas +
    percepNacion +
    monto15(0) +
    monto15(0) +
    monto15(0) +
    "PES" +
    tipoCambioPesos() +
    cantAli +
    " " +
    monto15(0) +
    fecha;

  assertExactLen("VENTAS_CBTE", line, 266);
  return line;
}

export function lineaVentasAli(f: NormalizedFact): string | null {
  const letra = resolverLetraComprob(f.tipoComprobante, f.netoGravado, f.iva);
  const nc = esNotaCredito(f.tipoComprobante);
  if (letra !== "A" || !(f.netoGravado > 0 && f.iva > 0)) return null;
  const tipoCod = fixedNumeric(mapTipoVentasCodigo(tipoComprobMapKey(letra, nc), nc), 3);
  const line =
    tipoCod +
    tpv5(f.puntoVenta) +
    nroCbte20(f.numero) +
    monto15(f.netoGravado) +
    inferirCodigoAlicuota(f.netoGravado, f.iva) +
    monto15(f.iva);

  assertExactLen("VENTAS_ALI", line, 62);
  return line;
}

export function lineaComprasCabecera(f: NormalizedFact): string {
  const letra = resolverLetraComprob(f.tipoComprobante, f.netoGravado, f.iva);
  const nc = esNotaCredito(f.tipoComprobante);
  const tipoCod = fixedNumeric(mapTipoComprasCodigo(tipoComprobMapKey(letra, nc), nc), 3);
  const fecha = yyyymmddFromIsoUtc(f.fechaIso);
  const { cod: docCod, id20 } = docCodigoYLlaveIdent(f.cuit);
  const denom = fixedAlpha(f.razonsocial, 30);
  const despacho = " ".repeat(16);
  const cantAli = letra === "A" && f.netoGravado > 0 && f.iva > 0 ? "1" : "0";
  const creditoComput =
    letra === "A" && f.netoGravado > 0 && f.iva > 0 ? monto15(f.iva) : monto15(0);
  const otrosTrib = monto15(f.otrosImpuestos);
  const noIntegran = monto15(0);
  const exentas = monto15(0);
  const cero15 = monto15(0);

  const line =
    fecha +
    tipoCod +
    tpv5(f.puntoVenta) +
    nroCbte20(f.numero) +
    despacho +
    docCod +
    id20 +
    denom +
    monto15(f.total) +
    noIntegran +
    exentas +
    cero15 +
    cero15 +
    cero15 +
    cero15 +
    cero15 +
    "PES" +
    tipoCambioPesos() +
    cantAli +
    " " +
    creditoComput +
    otrosTrib +
    fixedNumeric("", 11) +
    fixedAlpha("", 30) +
    monto15(0);

  assertExactLen("COMPRAS_CBTE", line, 325);
  return line;
}

export function lineaComprasAli(f: NormalizedFact): string | null {
  const letra = resolverLetraComprob(f.tipoComprobante, f.netoGravado, f.iva);
  const nc = esNotaCredito(f.tipoComprobante);
  if (letra !== "A" || !(f.netoGravado > 0 && f.iva > 0)) return null;

  const tipoCod = fixedNumeric(mapTipoComprasCodigo(tipoComprobMapKey(letra, nc), nc), 3);
  const { cod, id20 } = docCodigoYLlaveIdent(f.cuit);
  const line =
    tipoCod +
    tpv5(f.puntoVenta) +
    nroCbte20(f.numero) +
    cod +
    id20 +
    monto15(f.netoGravado) +
    inferirCodigoAlicuota(f.netoGravado, f.iva) +
    monto15(f.iva);

  assertExactLen("COMPRAS_ALI", line, 84);
  return line;
}

export function buildLibroIvaTxtFiles(facts: NormalizedFact[]): {
  ventasCbte: string;
  ventasAli: string;
  comprasCbte: string;
  comprasAli: string;
} {
  const ventas = facts.filter((r) => r.tipo === "venta");
  const compras = facts.filter((r) => r.tipo === "compra");

  const vAliLines = ventas.map(lineaVentasAli).filter((x): x is string => x != null);
  const cAliLines = compras.map(lineaComprasAli).filter((x): x is string => x != null);

  return {
    ventasCbte: ventas.map(lineaVentasCabecera).join("\r\n") + (ventas.length ? "\r\n" : ""),
    ventasAli: vAliLines.join("\r\n") + (vAliLines.length ? "\r\n" : ""),
    comprasCbte: compras.map(lineaComprasCabecera).join("\r\n") + (compras.length ? "\r\n" : ""),
    comprasAli: cAliLines.join("\r\n") + (cAliLines.length ? "\r\n" : ""),
  };
}
