import { describe, expect, it } from "vitest";
import {
  buildBankReference,
  inferKindFromImporteAndConcepto,
  normalizeBankExtractRows,
  normalizeBankMovement,
  parseFechaYmd,
} from "@/lib/accounting/bank-extract";

describe("bank-extract", () => {
  it("parseFechaYmd acepta DD/MM/YYYY", () => {
    expect(parseFechaYmd("12/05/2026")).toBe("2026-05-12");
    expect(parseFechaYmd("2026-05-12")).toBe("2026-05-12");
  });

  it("crédito CCERR → cobro", () => {
    expect(
      inferKindFromImporteAndConcepto(2_054_580, "CCERR SEAM SERVIC 30667119517", undefined)
    ).toBe("cobro");
  });

  it("débito DBCR TASA → pago", () => {
    expect(inferKindFromImporteAndConcepto(-12_327.48, "DBCR 25413 S/CR TASA GRAL", undefined)).toBe("pago");
  });

  it("buildBankReference es estable", () => {
    const ref = buildBankReference({
      cuentaNumero: "385209425144719",
      fecha: "2026-05-12",
      referenciaBanco: "1955205345",
      importeSigned: -12327.48,
    });
    expect(ref).toContain("385209425144719");
    expect(ref).toContain("2026-05-12");
  });

  it("normaliza filas del extracto ejemplo", () => {
    const rows = normalizeBankExtractRows(
      [
        {
          fecha: "2026-05-12",
          importe: -12327.48,
          concepto: "DBCR 25413 S/CR TASA GRAL",
          referenciaBanco: "1955205345",
        },
        {
          fecha: "2026-05-12",
          importe: 2_054_580,
          concepto: "CCERR SEAM SERVIC 30667119517",
          referenciaBanco: "166150820",
        },
      ],
      "385209425144719"
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.kind).toBe("pago");
    expect(rows[0]!.importe).toBe(12327.48);
    expect(rows[1]!.kind).toBe("cobro");
    expect(rows[1]!.importe).toBe(2_054_580);
  });

  it("normalizeBankMovement rechaza importe cero", () => {
    expect(
      normalizeBankMovement(
        { fecha: "2026-05-12", importe: 0, concepto: "x" },
        "385209425144719"
      )
    ).toBeNull();
  });
});
