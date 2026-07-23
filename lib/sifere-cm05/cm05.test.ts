import { describe, expect, it } from "vitest";
import { aggregateCm05Period, gastoBaseImponible, getAmount } from "@/lib/sifere-cm05/aggregate";
import { rollupCm05Column } from "@/lib/sifere-cm05/codes";
import { buildCm05XlsBuffer } from "@/lib/sifere-cm05/build-xls";
import * as XLSX from "xlsx";
import * as path from "node:path";

describe("aggregateCm05Period", () => {
  it("pone ventas de servicios en 1106 y resta notas de crédito", () => {
    const r = aggregateCm05Period({
      jurisdiccion: "902",
      ventas: [
        { netoGravado: 1000, tipoComprobante: "A" },
        { netoGravado: 200, tipoComprobante: "credito_a" },
      ],
      gastos: [],
    });
    expect(r.ingresosNeto).toBe(800);
    expect(getAmount(r.amounts, "1106", "902")).toBe(800);
  });

  it("mapea categorías de gasto y omite aportes de socio", () => {
    const r = aggregateCm05Period({
      jurisdiccion: "901",
      ventas: [],
      gastos: [
        { amount: 500, accountingCategory: "honorarios" },
        { amount: 100, accountingCategory: "alquiler" },
        { amount: 999, accountingCategory: "aporte_reintegro_socio" },
        { amount: 50, accountingCategory: null },
      ],
    });
    expect(r.gastosOmitidosSocio).toBe(1);
    expect(getAmount(r.amounts, "2207", "901")).toBe(500);
    expect(getAmount(r.amounts, "2214", "901")).toBe(100);
    expect(getAmount(r.amounts, "2226", "901")).toBe(50);
    expect(r.gastosNeto).toBe(650);
  });
});

describe("gastoBaseImponible", () => {
  it("prefiere neto+exento", () => {
    expect(
      gastoBaseImponible({
        totalAmount: 1210,
        netTaxedAmount: 1000,
        exemptAmount: 0,
        vat21Amount: 210,
        vat105Amount: 0,
        vat27Amount: 0,
        vatPerceptionAmount: 0,
        grossIncomePerceptionAmount: 0,
        otherTaxesAmount: 0,
      })
    ).toBe(1000);
  });
});

describe("rollupCm05Column", () => {
  it("replica fórmulas del modelo ARCA", () => {
    const roll = rollupCm05Column((code) => (code === "1106" ? 1000 : code === "2207" ? 250 : 0));
    expect(roll["1100"]).toBe(1000);
    expect(roll["1000"]).toBe(1000);
    expect(roll["2200"]).toBe(250);
    expect(roll["2000"]).toBe(250);
  });
});

describe("buildCm05XlsBuffer", () => {
  it("escribe CUIT/razón/año e importes en el .xls modelo", () => {
    const amounts = aggregateCm05Period({
      jurisdiccion: "902",
      ventas: [{ netoGravado: 1500, tipoComprobante: "A" }],
      gastos: [{ amount: 300, accountingCategory: "marketing" }],
    }).amounts;

    const file = buildCm05XlsBuffer({
      year: 2026,
      month: 7,
      amounts,
      templatePath: path.join(process.cwd(), "assets/sifere/modelo_carga_resumen_periodo.xls"),
    });

    expect(file.filename).toBe("CM05_ingresos_gastos_2026-07.xls");
    const wb = XLSX.read(file.buffer, { type: "buffer" });
    const ws = wb.Sheets["GASTOS_INGRESOS"];
    expect(ws["J1"]?.v).toBe("33717298689");
    expect(ws["J2"]?.v).toBe("NOTIFICAS S. R. L.");
    expect(ws["J3"]?.v).toBe(2026);
    // G = 902 BS.AS.; fila 15 = 1106; fila 8 = 1000 rollup; fila 47 = 2211
    expect(ws["G15"]?.v).toBe(1500);
    expect(ws["G8"]?.v).toBe(1500);
    expect(ws["G47"]?.v).toBe(300);
    expect(ws["G30"]?.v).toBe(300);
  });
});
