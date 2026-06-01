import { describe, expect, it } from "vitest";
import {
  computePagoAlerts,
  isPagoExportableToIvaCompras,
  suggestVat21FromTotal,
  validateVatComputable,
  cuitsMatch,
} from "@/lib/accounting/pago-fiscal";

describe("suggestVat21FromTotal", () => {
  it("calcula neto e IVA 21% desde total", () => {
    const r = suggestVat21FromTotal(121);
    expect(r.netTaxedAmount).toBe(100);
    expect(r.vat21Amount).toBe(21);
  });
});

describe("validateVatComputable", () => {
  it("rechaza IVA computable sin CUIT", () => {
    const r = validateVatComputable({
      isVatComputable: true,
      invoiceType: "factura_a",
      supplierCuit: "",
      posNumber: "1",
      invoiceNumber: "100",
      issuedToCompany: true,
      netTaxedAmount: 100,
      vat21Amount: 21,
      vat105Amount: 0,
      vat27Amount: 0,
    });
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes("CUIT"))).toBe(true);
  });

  it("rechaza IVA computable en Factura B", () => {
    const r = validateVatComputable({
      isVatComputable: true,
      invoiceType: "factura_b",
      supplierCuit: "20123456789",
      posNumber: "1",
      invoiceNumber: "100",
      issuedToCompany: true,
      netTaxedAmount: 100,
      vat21Amount: 21,
      vat105Amount: 0,
      vat27Amount: 0,
    });
    expect(r.ok).toBe(false);
  });
});

describe("isPagoExportableToIvaCompras", () => {
  it("incluye gasto Factura A completo", () => {
    expect(
      isPagoExportableToIvaCompras({
        id: "x",
        invoiceDate: "2026-05-19",
        paymentDate: "2026-05-19",
        invoiceType: "factura_a",
        posNumber: "00001",
        invoiceNumber: "123",
        supplierCuit: "20123456789",
        supplierName: "Proveedor SA",
        isVatComputable: true,
        issuedToCompany: true,
        totalAmount: 121,
        netTaxedAmount: 100,
        vat21Amount: 21,
        vat105Amount: 0,
        vat27Amount: 0,
        vatPerceptionAmount: 0,
        grossIncomePerceptionAmount: 0,
        otherTaxesAmount: 0,
        exemptAmount: 0,
      })
    ).toBe(true);
  });
});

describe("computePagoAlerts", () => {
  it("advierte pago por socio con factura a nombre SRL", () => {
    const alerts = computePagoAlerts({
      isVatComputable: true,
      invoiceType: "factura_a",
      supplierCuit: "20123456789",
      posNumber: "1",
      invoiceNumber: "10",
      issuedToCompany: true,
      netTaxedAmount: 100,
      vat21Amount: 21,
      vat105Amount: 0,
      vat27Amount: 0,
      paidBy: "tarjeta_personal_socio",
    });
    expect(alerts.some((a) => a.message.includes("reintegro"))).toBe(true);
  });
});

describe("cuitsMatch", () => {
  it("normaliza guiones", () => {
    expect(cuitsMatch("33-71729868-9", "33717298689")).toBe(true);
  });
});
