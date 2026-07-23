import { describe, expect, it } from "vitest";
import { computeBienesPersonalesYear } from "@/lib/bienes-personales/aggregate";

describe("computeBienesPersonalesYear", () => {
  it("suma activos y pasivos y calcula patrimonio neto", () => {
    const r = computeBienesPersonalesYear(
      [
        { naturaleza: "activo", tipo: "inmueble", valuacionFiscal: 50_000_000 },
        { naturaleza: "activo", tipo: "cuenta_bancaria", valuacionFiscal: 5_000_000 },
        { naturaleza: "pasivo", tipo: "otro", valuacionFiscal: 10_000_000 },
      ],
      2025
    );

    expect(r.totalActivos).toBe(55_000_000);
    expect(r.totalPasivos).toBe(10_000_000);
    expect(r.patrimonioNeto).toBe(45_000_000);
    expect(r.activosPorTipo.inmueble).toBe(50_000_000);
    expect(r.activosPorTipo.cuenta_bancaria).toBe(5_000_000);
  });

  it("no cobra impuesto por debajo del mínimo no imponible", () => {
    const r = computeBienesPersonalesYear(
      [{ naturaleza: "activo", tipo: "cuenta_bancaria", valuacionFiscal: 1_000_000 }],
      2025
    );
    expect(r.impuestoEstimado).toBe(0);
  });

  it("aplica la escala progresiva por tramos sobre el excedente del mínimo", () => {
    // 2025: MNI 100M; tramo 1 hasta 300M excedente al 0.5%; tramo 2 hasta 1000M con cuota fija 1.5M + 0.75%.
    const r1 = computeBienesPersonalesYear(
      [{ naturaleza: "activo", tipo: "cuenta_bancaria", valuacionFiscal: 250_000_000 }],
      2025
    );
    // excedente = 150M, dentro del primer tramo (<=300M): 150M * 0.005 = 750.000
    expect(r1.impuestoEstimado).toBe(750_000);

    const r2 = computeBienesPersonalesYear(
      [{ naturaleza: "activo", tipo: "cuenta_bancaria", valuacionFiscal: 500_000_000 }],
      2025
    );
    // excedente = 400M, cae en el segundo tramo: 1.5M + (400M-300M)*0.0075 = 1.5M + 750.000 = 2.250.000
    expect(r2.impuestoEstimado).toBe(2_250_000);
  });

  it("años sin parámetros configurados no rompen el cálculo", () => {
    const r = computeBienesPersonalesYear(
      [{ naturaleza: "activo", tipo: "cuenta_bancaria", valuacionFiscal: 1_000_000 }],
      1999
    );
    expect(r.minimoNoImponible).toBe(0);
    expect(r.impuestoEstimado).toBe(0);
  });
});
