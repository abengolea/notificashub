import { describe, expect, it } from "vitest";
import { NormalizedFact, lineaComprasAli, lineaComprasCabecera, lineaVentasAli, lineaVentasCabecera } from "@/lib/arca-export/iva-lines";

const baseVentasFacturaA = (): NormalizedFact => ({
  id: "1",
  fechaIso: new Date(Date.UTC(2026, 2, 10, 12, 0, 0)).toISOString(),
  tipo: "venta",
  numero: "45",
  puntoVenta: "2",
  razonsocial: "CLIENTE SPA",
  cuit: "30123456789",
  tipoComprobante: "a",
  netoGravado: 1000,
  iva: 210,
  otrosImpuestos: 0,
  total: 1210,
});

describe("iva-lines AR export", () => {
  it("Ventas CBTE longitud 266", () => {
    const ln = lineaVentasCabecera(baseVentasFacturaA());
    expect(ln.length).toBe(266);
  });

  it("Ventas alícuota longitud 62", () => {
    const ln = lineaVentasAli(baseVentasFacturaA());
    expect(ln).not.toBeNull();
    expect(ln!.length).toBe(62);
  });

  it("Ventas clase C sin línea de alícuota", () => {
    const f = { ...baseVentasFacturaA(), tipoComprobante: "c", iva: 0 };
    expect(lineaVentasAli(f)).toBeNull();
  });

  it("Compras CBTE longitud 325", () => {
    const f = { ...baseVentasFacturaA(), tipo: "compra" as const };
    expect(lineaComprasCabecera(f).length).toBe(325);
  });

  it("Compras Ali longitud 84", () => {
    const f = { ...baseVentasFacturaA(), tipo: "compra" as const };
    const ln = lineaComprasAli(f);
    expect(ln).not.toBeNull();
    expect(ln!.length).toBe(84);
  });
});
