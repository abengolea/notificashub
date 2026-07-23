import { Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import {
  DEFAULT_ACCOUNTING_ENTITY_ID,
  getAccountingEntity,
  type AccountingEntityId,
} from "@/lib/accounting/constants";
import { mergeComprasNormalized, sumComprasResumen } from "@/lib/accounting/iva-compras-export";
import { buildIvaAuditReport, pagosComprasForPeriodWithFallback } from "@/lib/accounting/iva-audit";
import {
  buildLibroIvaTxtFiles,
  facturasFirestoreToNormalized,
  lineaComprasAli,
  lineaVentasAli,
  type FactFirestoreLike,
  type NormalizedFact,
} from "@/lib/arca-export/iva-lines";
import { onlyDigits } from "@/lib/arca-export/iva-encoding";

export type PeriodExportData = {
  year: number;
  month: number;
  periodoKey: string;
  ventas: NormalizedFact[];
  compras: NormalizedFact[];
  auditReport: ReturnType<typeof buildIvaAuditReport>;
  resumenIvahub: Record<string, unknown>;
  ganancCsv: string;
  txt: ReturnType<typeof buildLibroIvaTxtFiles>;
};

function bounds(year: number, month: number): { start: Timestamp; end: Timestamp } {
  const startD = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const endD = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { start: Timestamp.fromDate(startD), end: Timestamp.fromDate(endD) };
}

function resolverLetraA(n: NormalizedFact): "A" | "B" | "C" | null {
  const tc = n.tipoComprobante.toLowerCase();
  if (tc.includes("a") && !tc.includes("b") && !tc.includes("c")) return "A";
  if (tc === "a" || tc.startsWith("credito_a")) return "A";
  if (tc === "b" || tc.startsWith("credito_b")) return "B";
  if (tc === "c" || tc.startsWith("credito_c")) return "C";
  if (n.iva > 0 && n.netoGravado > 0) return "A";
  if (n.netoGravado > 0) return "B";
  return "C";
}

/** Carga facturas + pagos computables y arma TXT del período. */
export async function loadPeriodExportData(
  year: number,
  month: number,
  entityId: AccountingEntityId = DEFAULT_ACCOUNTING_ENTITY_ID
): Promise<PeriodExportData> {
  const entity = getAccountingEntity(entityId);
  const { start, end } = bounds(year, month);

  const [factSnap, pagSnap] = await Promise.all([
    db.collection(entity.collections.facturas).where("fecha", ">=", start).where("fecha", "<=", end).limit(4000).get(),
    db.collection(entity.collections.pagos).where("fecha", ">=", start).where("fecha", "<=", end).limit(4000).get(),
  ]);

  const normalizedFacturas = facturasFirestoreToNormalized(
    factSnap.docs.map((d) => ({ id: d.id, data: () => d.data() as FactFirestoreLike }))
  );

  const facturasVentas = normalizedFacturas.filter((f) => f.tipo === "venta");
  const facturasCompras = normalizedFacturas.filter((f) => f.tipo === "compra");

  const pagosDocs = pagSnap.docs.map((d) => ({ id: d.id, data: () => d.data() }));
  const pagosExport = pagosComprasForPeriodWithFallback(pagosDocs, year, month);
  const auditReport = buildIvaAuditReport(pagosDocs, year, month, facturasCompras.length);

  const compras = mergeComprasNormalized(facturasCompras, pagosExport.exportables);
  const ventas = facturasVentas;

  let ventasNeto = 0;
  let ventasIva = 0;
  let comprasNetoFacturas = 0;
  let comprasIvaFacturas = 0;
  let facturasComprasCount = 0;

  for (const f of ventas) {
    ventasNeto += f.netoGravado || 0;
    ventasIva += f.iva || 0;
  }
  for (const f of facturasCompras) {
    comprasNetoFacturas += f.netoGravado || 0;
    comprasIvaFacturas += f.iva || 0;
    facturasComprasCount += 1;
  }

  const comprasResumen = sumComprasResumen(
    { neto: comprasNetoFacturas, iva21: comprasIvaFacturas, iva105: 0, iva27: 0, count: facturasComprasCount },
    {
      netoGravadoCompras: pagosExport.netoGravado,
      ivaCredito21: pagosExport.ivaCredito21,
      ivaCredito105: pagosExport.ivaCredito105,
      ivaCredito27: pagosExport.ivaCredito27,
      totalIvaCredito: pagosExport.ivaCredito21 + pagosExport.ivaCredito105 + pagosExport.ivaCredito27,
      percepcionesIva: 0,
      percepcionesIibb: 0,
      totalComprobantesComputables: pagosExport.count,
      totalGastosNoComputables: auditReport.resumen.gastosExcluidos,
      desdeFacturas: 0,
      desdePagos: pagosExport.count,
    }
  );

  const periodoKey = `${year}-${String(month).padStart(2, "0")}`;
  const resumenIvahub = {
    empresaNombre: entity.displayName,
    periodo: periodoKey,
    facturasIncluidas: normalizedFacturas.length,
    pagosGastosEnPeriodo: pagSnap.docs.length,
    auditoriaIvaCompras: auditReport.resumen,
    ventas: { netoGravado: ventasNeto, iva: ventasIva, comprobantes: ventas.length },
    compras: {
      netoGravado: comprasResumen.netoGravadoCompras,
      iva: comprasResumen.totalIvaCredito,
      comprobantes: compras.length,
      detalle: comprasResumen,
    },
    diferenciaIVAOrientativa: ventasIva - comprasResumen.totalIvaCredito,
  };

  const ganancCsv =
    `"Concepto";"Valor ARS"\n` +
    `"Periodo YYYY-MM";"${periodoKey}"\n` +
    `"IVA Debito neto gravado ventas";"${ventasNeto.toFixed(2)}"\n` +
    `"IVA Debito impuesto ventas";"${ventasIva.toFixed(2)}"\n` +
    `"IVA Credito neto gravado compras";"${comprasResumen.netoGravadoCompras.toFixed(2)}"\n` +
    `"IVA Credito total compras";"${comprasResumen.totalIvaCredito.toFixed(2)}"\n` +
    `"Comprobantes computables compras";"${comprasResumen.totalComprobantesComputables}"\n` +
    `"Saldo tecnico IVA orientativo";"${String(resumenIvahub.diferenciaIVAOrientativa)}"\n`;

  const txt = buildLibroIvaTxtFiles([...ventas, ...compras]);

  return {
    year,
    month,
    periodoKey,
    ventas,
    compras,
    auditReport,
    resumenIvahub,
    ganancCsv,
    txt,
  };
}

export type ArcaModuleStats = {
  comprobantes: number;
  alicuotas: number;
  netoGravado: number;
  iva: number;
  sinCuit: number;
  facturaASinIva: number;
  sinTipoComprobante: number;
};

export type ArcaExportValidation = {
  ok: boolean;
  periodo: string;
  warnings: string[];
  compras: ArcaModuleStats & { comprobantesExcluidos: number };
  ventas: ArcaModuleStats;
  arcaImport: {
    compras: { menu: string; archivos: [string, string] };
    ventas: { menu: string; archivos: [string, string] };
  };
};

function statsCompras(compras: NormalizedFact[]): ArcaModuleStats {
  let sinCuit = 0;
  let facturaASinIva = 0;
  let neto = 0;
  let iva = 0;
  let alicuotas = 0;

  for (const c of compras) {
    neto += c.netoGravado || 0;
    iva += c.iva || 0;
    if (lineaComprasAli(c)) alicuotas += 1;
    const cuit = onlyDigits(c.cuit);
    if (cuit.length !== 11) sinCuit += 1;
    if (resolverLetraA(c) === "A" && !(c.iva > 0 && c.netoGravado > 0)) facturaASinIva += 1;
  }

  return {
    comprobantes: compras.length,
    alicuotas,
    netoGravado: neto,
    iva,
    sinCuit,
    facturaASinIva,
    sinTipoComprobante: 0,
  };
}

function statsVentas(ventas: NormalizedFact[]): ArcaModuleStats {
  let sinCuit = 0;
  let facturaASinIva = 0;
  let sinTipoComprobante = 0;
  let neto = 0;
  let iva = 0;
  let alicuotas = 0;

  for (const v of ventas) {
    neto += v.netoGravado || 0;
    iva += v.iva || 0;
    if (lineaVentasAli(v)) alicuotas += 1;
    const cuit = onlyDigits(v.cuit);
    if (cuit.length !== 11) sinCuit += 1;
    if (!v.tipoComprobante?.trim()) sinTipoComprobante += 1;
    if (resolverLetraA(v) === "A" && !(v.iva > 0 && v.netoGravado > 0)) facturaASinIva += 1;
  }

  return {
    comprobantes: ventas.length,
    alicuotas,
    netoGravado: neto,
    iva,
    sinCuit,
    facturaASinIva,
    sinTipoComprobante,
  };
}

/** Validación previa a exportar — no genera archivos. */
export function validateArcaExport(data: PeriodExportData): ArcaExportValidation {
  const warnings: string[] = [];
  const comprasStats = statsCompras(data.compras);
  const ventasStats = statsVentas(data.ventas);
  const excluidos = data.auditReport.resumen.gastosExcluidos;

  if (comprasStats.comprobantes === 0) {
    warnings.push("No hay comprobantes de compras para exportar en este período.");
  }
  if (ventasStats.comprobantes === 0) {
    warnings.push("No hay comprobantes de ventas para exportar en este período.");
  }
  if (comprasStats.sinCuit > 0) {
    warnings.push(`Existen ${comprasStats.sinCuit} compra(s) sin CUIT válido (11 dígitos).`);
  }
  if (comprasStats.facturaASinIva > 0) {
    warnings.push(`Existen ${comprasStats.facturaASinIva} Factura(s) A de compras sin IVA discriminado.`);
  }
  if (excluidos > 0) {
    warnings.push(`Existen ${excluidos} gasto(s) del período excluidos del Libro Compras (ver Auditoría IVA).`);
  }
  if (ventasStats.sinTipoComprobante > 0) {
    warnings.push(`Existen ${ventasStats.sinTipoComprobante} venta(s) sin tipo de comprobante cargado.`);
  }
  if (ventasStats.sinCuit > 0) {
    warnings.push(`Existen ${ventasStats.sinCuit} venta(s) sin CUIT de cliente válido.`);
  }
  if (ventasStats.facturaASinIva > 0) {
    warnings.push(`Existen ${ventasStats.facturaASinIva} Factura(s) A de ventas sin IVA discriminado.`);
  }

  const ok =
    warnings.filter((w) => w.includes("sin CUIT") || w.includes("sin IVA discriminado")).length === 0;

  return {
    ok,
    periodo: data.periodoKey,
    warnings,
    compras: { ...comprasStats, comprobantesExcluidos: excluidos },
    ventas: ventasStats,
    arcaImport: {
      compras: {
        menu: "Libro IVA → Compras → Importar",
        archivos: ["LIBRO_IVA_DIGITAL_COMPRAS_CBTE.txt", "LIBRO_IVA_DIGITAL_COMPRAS_ALICUOTAS.txt"],
      },
      ventas: {
        menu: "Libro IVA → Ventas → Importar",
        archivos: ["LIBRO_IVA_DIGITAL_VENTAS_CBTE.txt", "LIBRO_IVA_DIGITAL_VENTAS_ALICUOTAS.txt"],
      },
    },
  };
}

export function txtToLatin1Buffer(content: string): Buffer {
  return Buffer.from(content.replace(/\r?\n/g, "\r\n"), "latin1");
}
