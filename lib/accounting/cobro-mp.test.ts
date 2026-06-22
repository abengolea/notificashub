import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import {
  cobroInputFromFacturaVentaMp,
  cobroInputFromMpPaymentAndFactura,
  formatFacturaVentaLabel,
  observacionesCobroMpFactura,
} from "./cobro-mp";

describe("formatFacturaVentaLabel", () => {
  it("formatea PV y número", () => {
    expect(formatFacturaVentaLabel({ tipoComprobante: "B", puntoVenta: "3", numero: "42" })).toBe(
      "B 00003-00000042"
    );
  });
});

describe("observacionesCobroMpFactura", () => {
  it("incluye factura y MP", () => {
    expect(
      observacionesCobroMpFactura({
        facturaLabel: "B 00001-00000100",
        mercadopagoPaymentId: "998877",
        sourceLabel: "Notificas",
      })
    ).toContain("MP #998877");
  });
});

describe("cobroInputFromFacturaVentaMp", () => {
  it("arma input desde factura venta MP", () => {
    const input = cobroInputFromFacturaVentaMp({
      id: "mp_999",
      data: {
        tipo: "venta",
        sourcePaymentId: "888777",
        total: 5000,
        tipoComprobante: "B",
        puntoVenta: "2",
        numero: "10",
        fecha: Timestamp.fromDate(new Date(Date.UTC(2026, 4, 10, 12, 0, 0))),
        razonsocial: "Cliente SA",
        sourceSystem: "notificas",
      },
    });
    expect(input?.mercadopagoPaymentId).toBe("888777");
    expect(input?.facturaId).toBe("mp_999");
    expect(input?.importe).toBe(5000);
  });
});

describe("cobroInputFromMpPaymentAndFactura", () => {
  it("arma input desde pago MP y factura", () => {
    const input = cobroInputFromMpPaymentAndFactura(
      { id: 123, transaction_amount: 1210, description: "Plan Pro" },
      {
        id: "mp_123",
        data: {
          total: 1210,
          tipoComprobante: "B",
          puntoVenta: "1",
          numero: "50",
          sourceSystem: "notificas",
        },
      },
      "2026-05-15"
    );
    expect(input.facturaId).toBe("mp_123");
    expect(input.mercadopagoPaymentId).toBe("123");
    expect(input.importe).toBe(1210);
    expect(input.fechaYmd).toBe("2026-05-15");
  });
});
