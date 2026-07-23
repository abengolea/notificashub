import { describe, expect, it } from "vitest";
import { computeGananciasYear } from "@/lib/ganancias/aggregate";

describe("computeGananciasYear", () => {
  it("agrega ingresos y gastos por mes y calcula resultado neto", () => {
    const r = computeGananciasYear({
      year: 2026,
      ventas: [
        { month: 1, netoGravado: 1000 },
        { month: 1, netoGravado: 500 },
        { month: 2, netoGravado: 800 },
      ],
      gastos: [
        { month: 1, amount: 300, accountingCategory: "honorarios" },
        { month: 1, amount: 100, accountingCategory: "alquiler" },
        { month: 2, amount: 200, accountingCategory: "honorarios" },
      ],
      deducciones: [{ month: 1, categoria: "obra_social", importe: 50 }],
    });

    expect(r.months[0].ingresoBruto).toBe(1500);
    expect(r.months[0].totalGastosDeducibles).toBe(400);
    expect(r.months[0].gastosPorCategoria.honorarios).toBe(300);
    expect(r.months[0].gastosPorCategoria.alquiler).toBe(100);
    expect(r.months[0].deduccionesPersonales).toBe(50);
    expect(r.months[0].resultadoNeto).toBe(1050);

    expect(r.months[1].ingresoBruto).toBe(800);
    expect(r.months[1].totalGastosDeducibles).toBe(200);
    expect(r.months[1].resultadoNeto).toBe(600);

    expect(r.totalIngresoBruto).toBe(2300);
    expect(r.totalGastosDeducibles).toBe(600);
    expect(r.totalDeduccionesPersonales).toBe(50);
    expect(r.totalResultadoNeto).toBe(1650);
  });

  it("meses sin movimientos quedan en cero", () => {
    const r = computeGananciasYear({ year: 2026, ventas: [], gastos: [], deducciones: [] });
    expect(r.months).toHaveLength(12);
    expect(r.months.every((m) => m.resultadoNeto === 0)).toBe(true);
    expect(r.totalResultadoNeto).toBe(0);
  });
});
