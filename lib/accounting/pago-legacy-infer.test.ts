import { describe, expect, it } from "vitest";
import { detectInvoiceTypeFromText, inferLegacyFiscalFields, extractPdfPathFromObservaciones } from "@/lib/accounting/pago-legacy-infer";
import { pagoDocToRecord } from "@/lib/accounting/pago-persist";
import { auditPagoItem } from "@/lib/accounting/iva-audit";

describe("detectInvoiceTypeFromText", () => {
  it("detecta Factura A en observaciones", () => {
    expect(detectInvoiceTypeFromText("Factura A + link PDF")).toBe("factura_a");
  });
});

describe("inferLegacyFiscalFields", () => {
  it("reconstruye IVA desde total en gasto legacy", () => {
    const rec = pagoDocToRecord("test1", {
      fecha: "2026-05-19T12:00:00.000Z",
      importe: 18212,
      concepto: "Disco Rígido",
      proveedor: "Todo Insumos",
      observaciones: "Factura A",
      pdfStoragePath: "accounting-notificas-srl/pdf-inbox/test.pdf",
    });
    const inf = inferLegacyFiscalFields(rec);
    expect(inf.invoiceType).toBe("factura_a");
    expect(inf.isVatComputable).toBe(true);
    expect(inf.netTaxedAmount).toBeGreaterThan(0);
    expect(inf.vat21Amount).toBeGreaterThan(0);
    expect(inf.inferredFields).toContain("invoiceType");
  });
});

describe("auditPagoItem legacy", () => {
  it("excluye por falta CUIT/PV/número aunque infiera Factura A", () => {
    const doc = {
      id: "legacy1",
      data: () => ({
        fecha: "2026-05-19T12:00:00.000Z",
        importe: 18212,
        concepto: "Disco Rígido Externo",
        proveedor: "Todo Insumos",
        observaciones: "Factura A",
      }),
    };
    const item = auditPagoItem(doc, 2026, 5);
    expect(item.invoiceTypeEffective).toBe("factura_a");
    expect(item.exportableAfterResolve).toBe(false);
    expect(item.motivos.some((m) => m.includes("CUIT"))).toBe(true);
    expect(item.ivaPotencialPerdido).toBeGreaterThan(0);
  });
});

describe("extractPdfPathFromObservaciones", () => {
  it("extrae path desde nota legacy", () => {
    const p = extractPdfPathFromObservaciones("Factura A\nPDF: gs://bucket/accounting-notificas-srl/pdf-inbox/doc.pdf");
    expect(p).toContain("accounting-notificas-srl");
  });
});
