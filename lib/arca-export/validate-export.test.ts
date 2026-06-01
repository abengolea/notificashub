import { describe, expect, it } from "vitest";
import { validateArcaExport, type PeriodExportData } from "@/lib/arca-export/period-export";
import type { NormalizedFact } from "@/lib/arca-export/iva-lines";

function mockData(overrides: Partial<PeriodExportData> = {}): PeriodExportData {
  const venta: NormalizedFact = {
    id: "v1",
    fechaIso: "2026-05-10T12:00:00.000Z",
    tipo: "venta",
    numero: "1",
    puntoVenta: "2",
    razonsocial: "Cliente SA",
    cuit: "30123456789",
    tipoComprobante: "a",
    netoGravado: 1000,
    iva: 210,
    otrosImpuestos: 0,
    total: 1210,
  };
  const compra: NormalizedFact = {
    ...venta,
    id: "c1",
    tipo: "compra",
    cuit: "20123456789",
  };
  const base: PeriodExportData = {
    year: 2026,
    month: 5,
    periodoKey: "2026-05",
    ventas: [venta],
    compras: [compra],
    auditReport: {
      periodo: { year: 2026, month: 5, key: "2026-05" },
      resumen: {
        totalGastosPeriodo: 0,
        gastosConPdf: 0,
        gastosFacturaAStored: 0,
        gastosFacturaAEffective: 0,
        gastosIvaComputableStored: 0,
        gastosIvaComputableEffective: 0,
        gastosExportados: 0,
        gastosExcluidos: 0,
        gastosInferidosPendientes: 0,
        ivaCreditoPotencialPerdido: 0,
        ivaCreditoExportable: 0,
        facturasCompraExportadas: 1,
      },
      gastos: [],
      lineasTexto: [],
    },
    resumenIvahub: {},
    ganancCsv: "",
    txt: {
      ventasCbte: "",
      ventasAli: "",
      comprasCbte: "",
      comprasAli: "",
    },
  };
  return { ...base, ...overrides };
}

describe("validateArcaExport", () => {
  it("sin advertencias críticas cuando datos completos", () => {
    const v = validateArcaExport(mockData());
    expect(v.compras.comprobantes).toBe(1);
    expect(v.ventas.comprobantes).toBe(1);
    expect(v.compras.alicuotas).toBe(1);
    expect(v.warnings.filter((w) => w.includes("sin CUIT"))).toHaveLength(0);
  });

  it("advierte compras sin CUIT", () => {
    const compraSinCuit = { ...mockData().compras[0]!, cuit: "" };
    const v = validateArcaExport(mockData({ compras: [compraSinCuit] }));
    expect(v.warnings.some((w) => w.includes("sin CUIT"))).toBe(true);
    expect(v.compras.sinCuit).toBe(1);
  });

  it("advierte ventas sin tipo comprobante", () => {
    const ventaSinTipo = { ...mockData().ventas[0]!, tipoComprobante: "" };
    const v = validateArcaExport(mockData({ ventas: [ventaSinTipo] }));
    expect(v.warnings.some((w) => w.includes("sin tipo de comprobante"))).toBe(true);
  });
});
