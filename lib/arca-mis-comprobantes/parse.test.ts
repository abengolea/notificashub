import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import { parseMisComprobantesCsv } from "@/lib/arca-mis-comprobantes/parse";
import { parseMisComprobantesBuffer } from "@/lib/arca-mis-comprobantes/parse-file";
import { misComprobanteDedupeKey, recibidosToPagoDraft, cbteTipoToHub } from "@/lib/arca-mis-comprobantes/map";

const SAMPLE_RECIBIDOS = `Fecha;Tipo de Comprobante;Punto de Venta;Número Desde;Número Hasta;Cód. Autorización;Tipo Doc. Emisor;Nro. Doc. Emisor;Denominación Emisor;Tipo Cambio;Moneda;Imp. Neto Gravado;Imp. Neto No Gravado;Imp. Op. Exentas;Otros Tributos;IVA;Imp. Total
15/07/2026;1 - Factura A;0003;00000042;00000042;71234567890123;80;30711222333;PROVEEDOR SA;1,00;PES;1000,00;0,00;0,00;0,00;210,00;1210,00
20/07/2026;6 - Factura B;0001;10;10;71234567890124;80;20123456789;Monotribuyente X;1;PES;500;0;0;0;0;500
`;

const SAMPLE_EMITIDOS = `Fecha,Tipo de Comprobante,Punto de Venta,Número Desde,Número Hasta,Cód. Autorización,Tipo Doc. Receptor,Nro. Doc. Receptor,Denominación Receptor,Tipo Cambio,Moneda,Imp. Neto Gravado,Imp. Neto No Gravado,Imp. Op. Exentas,Otros Tributos,IVA,Imp. Total
01/07/2026,1 - Factura A,2,15,15,74112153083444,80,30710911496,CLIENTE SA,1.00,PES,"1.500,00",0.00,0.00,0.00,"315,00","1.815,00"
`;

const SAMPLE_ARCA_XLSX_STYLE = `Mis Comprobantes Emitidos - CUIT 33717298689;;;;;;;;;;;;;;;;;;;;;;;;;;;
Fecha;Tipo;Punto de Venta;Número Desde;Número Hasta;Cód. Autorización;Tipo Doc. Receptor;Nro. Doc. Receptor;Denominación Receptor;Tipo Cambio;Moneda;Neto Grav. IVA 0%;IVA 2,5%;Neto Grav. IVA 2,5%;IVA 5%;Neto Grav. IVA 5%;IVA 10,5%;Neto Grav. IVA 10,5%;IVA 21%;Neto Grav. IVA 21%;IVA 27%;Neto Grav. IVA 27%;Neto Gravado Total;Neto No Gravado;Op. Exentas;Otros Tributos;Total IVA;Imp. Total
01/06/2026;6 - Factura B;1;9;9;86227909404392;99;0;;1;$;0;0;0;0;0;0;0;17.36;82.64;0;0;82.64;0;0;0;17.36;100
`;

describe("parseMisComprobantesCsv", () => {
  it("parsea recibidos con ; y montos AR", () => {
    const r = parseMisComprobantesCsv(SAMPLE_RECIBIDOS);
    expect(r.kind).toBe("recibido");
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].netoGravado).toBe(1000);
    expect(r.rows[0].iva).toBe(210);
    expect(r.rows[0].contraparteCuit).toBe("30711222333");
    expect(r.rows[1].total).toBe(500);
  });

  it("parsea emitidos con coma", () => {
    const r = parseMisComprobantesCsv(SAMPLE_EMITIDOS);
    expect(r.kind).toBe("emitido");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].netoGravado).toBe(1500);
    expect(r.rows[0].total).toBe(1815);
  });

  it("omite fila título y usa Neto Gravado Total / Total IVA", () => {
    const r = parseMisComprobantesCsv(SAMPLE_ARCA_XLSX_STYLE, "emitido");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].netoGravado).toBe(82.64);
    expect(r.rows[0].iva).toBe(17.36);
    expect(r.rows[0].total).toBe(100);
    expect(r.rows[0].tipoCodigo).toBe(6);
  });
});

describe("map Mis Comprobantes", () => {
  it("mapea Factura A recibida a pago computable", () => {
    const r = parseMisComprobantesCsv(SAMPLE_RECIBIDOS).rows[0];
    const draft = recibidosToPagoDraft(r);
    expect(draft.isVatComputable).toBe(true);
    expect(draft.invoiceType).toBe("factura_a");
    expect(draft.netTaxedAmount).toBe(1000);
    expect(misComprobanteDedupeKey(r)).toContain("R|1|");
  });

  it("detecta NC", () => {
    expect(cbteTipoToHub(3).tipoComprobante).toBe("credito_a");
  });
});

describe("archivos reales ARCA", () => {
  const emitidos = "c:/Users/Adrian/Downloads/Mis Comprobantes Emitidos - CUIT 33717298689.xlsx";
  const recibidos = "c:/Users/Adrian/Downloads/Mis Comprobantes Recibidos - CUIT 33717298689.xlsx";

  it("lee Emitidos XLSX", () => {
    if (!fs.existsSync(emitidos)) return;
    const r = parseMisComprobantesBuffer(fs.readFileSync(emitidos), "Mis Comprobantes Emitidos.xlsx");
    expect(r.kind).toBe("emitido");
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows[0].total).toBeGreaterThan(0);
  });

  it("lee Recibidos XLSX", () => {
    if (!fs.existsSync(recibidos)) return;
    const r = parseMisComprobantesBuffer(fs.readFileSync(recibidos), "Mis Comprobantes Recibidos.xlsx");
    expect(r.kind).toBe("recibido");
    expect(r.rows.length).toBeGreaterThan(0);
  });
});
