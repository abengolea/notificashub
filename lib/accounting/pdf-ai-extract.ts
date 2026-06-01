import {
  accountingPdfModel,
  getGenerativeModel,
  parseModelJsonObject,
  pdfBase64Payload,
} from "@/lib/ai/google-gemini";
import type { RawBankMovement } from "@/lib/accounting/bank-extract";
import { medioPagoSchema, tipoComprobanteSchema, invoiceTypeSchema } from "@/lib/accounting/schemas";
import { cuitsMatch, NOTIFICAS_CUIT, normalizeCuitDigits } from "@/lib/accounting/pago-fiscal";

const FACTURA_JSON_INSTRUCTION = `Respondé SOLO un objeto JSON válido (sin markdown) con exactamente estas claves y tipos:
{
  "numero": string,
  "puntoVenta": string,
  "fecha": string (YYYY-MM-DD),
  "razonsocial": string,
  "cuit": string,
  "tipoComprobante": "A"|"B"|"C"|"credito_a"|"credito_b"|"credito_c"|"otro",
  "netoGravado": number,
  "iva": number,
  "otrosImpuestos": number,
  "total": number,
  "observaciones": string
}`;

const EXTRACTO_BANCO_JSON_INSTRUCTION = `Respondé SOLO un objeto JSON válido (sin markdown) con exactamente estas claves:
{
  "cuentaNumero": string (número de cuenta corriente sin espacios),
  "moneda": string (ej. ARS, PESOS),
  "movimientos": [
    {
      "fecha": string (YYYY-MM-DD),
      "importe": number (positivo si entra dinero a la cuenta, negativo si sale),
      "concepto": string (texto de causal/concepto tal como figura),
      "referenciaBanco": string (número de referencia / comprobante si aparece),
      "saldo": number (saldo después del movimiento si figura, sino 0),
      "clasificacion": "cobro"|"pago"|"ignorar" (orientativo)
    }
  ]
}
Incluí TODAS las filas de movimientos del extracto, no encabezados ni totales.`;

const PAGO_FISCAL_JSON_INSTRUCTION = `Respondé SOLO un objeto JSON válido (sin markdown) con exactamente estas claves y tipos:
{
  "invoiceType": "factura_a"|"factura_b"|"factura_c"|"ticket"|"recibo"|"sin_comprobante"|"otro",
  "posNumber": string,
  "invoiceNumber": string,
  "supplierCuit": string (11 dígitos sin guiones),
  "supplierName": string,
  "supplierVatCondition": "responsable_inscripto"|"monotributo"|"exento"|"consumidor_final"|"otro",
  "invoiceDate": string (YYYY-MM-DD),
  "paymentDate": string (YYYY-MM-DD, fecha de pago si difiere),
  "totalAmount": number,
  "netTaxedAmount": number,
  "vat21Amount": number,
  "vat105Amount": number,
  "vat27Amount": number,
  "exemptAmount": number,
  "vatPerceptionAmount": number,
  "grossIncomePerceptionAmount": number,
  "otherTaxesAmount": number,
  "concepto": string (descripción breve del gasto),
  "paymentMethod": "transferencia"|"efectivo"|"cheque"|"tarjeta"|"otro",
  "receiverCuit": string (CUIT del receptor/comprador en la factura, 11 dígitos),
  "receiverName": string,
  "observaciones": string
}`;

const PAGO_JSON_INSTRUCTION = `Respondé SOLO un objeto JSON válido (sin markdown) con exactamente estas claves y tipos:
{
  "fecha": string (YYYY-MM-DD),
  "importe": number,
  "concepto": string,
  "proveedor": string,
  "medio": "transferencia"|"efectivo"|"cheque"|"tarjeta"|"otro",
  "observaciones": string
}`;

function normalizeCuitOptional(s: string): string | undefined {
  const d = normalizeCuitDigits(s);
  return d.length > 0 ? d : undefined;
}

function coerceTipoComprobante(v: unknown): string | undefined {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  const parsed = tipoComprobanteSchema.safeParse(s || "otro");
  return parsed.success ? parsed.data : "otro";
}

function coerceMedio(v: unknown): string | undefined {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  const parsed = medioPagoSchema.safeParse(s || "otro");
  return parsed.success ? parsed.data : "otro";
}

export async function extractFacturaFromPdf(params: {
  pdfBase64: string;
  filename: string;
  tipoLibro: "venta" | "compra";
}) {
  const model = getGenerativeModel(accountingPdfModel());
  const pdfData = pdfBase64Payload(params.pdfBase64);
  const contexto =
    params.tipoLibro === "venta"
      ? "factura emitida / ventas — IVA débito"
      : "factura recibida / compras — IVA crédito";

  const prompt =
    "Sos un asistente contable para Argentina (AFIP/comprobantes). Analizá el PDF adjunto. " +
    `El usuario clasificó el comprobante como libro ${params.tipoLibro} (${contexto}). ` +
    "Extraé los datos del comprobante. Fecha siempre YYYY-MM-DD. Importes numéricos con punto decimal. " +
    "Si un dato no figura, usá cadena vacía o 0 según corresponda.\n\n" +
    FACTURA_JSON_INSTRUCTION;

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: "application/pdf",
              data: pdfData,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
    },
  });

  const rawText = result.response.text()?.trim();
  if (!rawText) {
    throw new Error("El modelo no devolvió datos.");
  }
  const raw = parseModelJsonObject(rawText);
  return {
    tipo: params.tipoLibro,
    numero: String(raw.numero ?? "").trim(),
    puntoVenta: String(raw.puntoVenta ?? "").trim() || undefined,
    fecha: String(raw.fecha ?? "").trim(),
    razonsocial: String(raw.razonsocial ?? "").trim(),
    cuit: normalizeCuitOptional(String(raw.cuit ?? "")),
    tipoComprobante: coerceTipoComprobante(raw.tipoComprobante),
    netoGravado: Number(raw.netoGravado ?? 0),
    iva: Number(raw.iva ?? 0),
    otrosImpuestos: Number(raw.otrosImpuestos ?? 0),
    total: Number(raw.total ?? 0),
    observaciones: String(raw.observaciones ?? "").trim() || undefined,
  };
}

function coerceInvoiceType(v: unknown): string | undefined {
  const s = typeof v === "string" ? v.trim().toLowerCase().replace(/\s+/g, "_") : "";
  const map: Record<string, string> = {
    a: "factura_a",
    factura_a: "factura_a",
    "factura a": "factura_a",
    b: "factura_b",
    factura_b: "factura_b",
    "factura b": "factura_b",
    c: "factura_c",
    factura_c: "factura_c",
    "factura c": "factura_c",
    ticket: "ticket",
    recibo: "recibo",
    sin_comprobante: "sin_comprobante",
    otro: "otro",
  };
  const key = map[s] ?? s;
  const parsed = invoiceTypeSchema.safeParse(key);
  return parsed.success ? parsed.data : undefined;
}

function coerceSupplierVatCondition(v: unknown): string | undefined {
  const s = typeof v === "string" ? v.trim().toLowerCase().replace(/\s+/g, "_") : "";
  const allowed = ["responsable_inscripto", "monotributo", "exento", "consumidor_final", "otro"] as const;
  return (allowed as readonly string[]).includes(s) ? s : undefined;
}

export type PagoFiscalExtract = {
  invoiceType?: string;
  posNumber?: string;
  invoiceNumber?: string;
  supplierCuit?: string;
  supplierName?: string;
  supplierVatCondition?: string;
  invoiceDate?: string;
  paymentDate?: string;
  totalAmount: number;
  netTaxedAmount: number;
  vat21Amount: number;
  vat105Amount: number;
  vat27Amount: number;
  exemptAmount: number;
  vatPerceptionAmount: number;
  grossIncomePerceptionAmount: number;
  otherTaxesAmount: number;
  concepto: string;
  proveedor?: string;
  fecha: string;
  importe: number;
  medio?: string;
  observaciones?: string;
  receiverCuit?: string;
  receiverName?: string;
  issuedToCompany: boolean | null;
  isVatComputable: boolean;
};

export async function extractPagoFiscalFromPdf(params: { pdfBase64: string; filename: string }): Promise<PagoFiscalExtract> {
  const model = getGenerativeModel(accountingPdfModel());
  const pdfData = pdfBase64Payload(params.pdfBase64);

  const prompt =
    "Sos un asistente contable para Argentina (AFIP/comprobantes). Analizá el PDF adjunto (factura de compra o comprobante de gasto). " +
    "Extraé todos los datos fiscales posibles: tipo de factura (A/B/C), punto de venta, número, CUIT y razón social del emisor/proveedor, " +
    "condición IVA del proveedor si figura, fecha del comprobante, importes (total, neto gravado, IVA 21%, 10.5%, 27%, exento, percepciones IVA e IIBB, otros impuestos). " +
    "También extraé CUIT y razón social del RECEPTOR/COMPRADOR para verificar si la factura está a nombre de NOTIFICAS S. R. L. (CUIT 33717298689). " +
    "Fechas YYYY-MM-DD. Importes numéricos con punto decimal. Si un dato no figura, cadena vacía o 0.\n\n" +
    PAGO_FISCAL_JSON_INSTRUCTION;

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: "application/pdf",
              data: pdfData,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
    },
  });

  const rawText = result.response.text()?.trim();
  if (!rawText) {
    throw new Error("El modelo no devolvió datos.");
  }
  const raw = parseModelJsonObject(rawText);

  const receiverCuit = normalizeCuitDigits(String(raw.receiverCuit ?? ""));
  const issuedToCompany = receiverCuit ? cuitsMatch(receiverCuit, NOTIFICAS_CUIT) : null;
  const invoiceType = coerceInvoiceType(raw.invoiceType);
  const totalAmount = Number(raw.totalAmount ?? raw.importe ?? 0);
  const paymentDate = String(raw.paymentDate ?? raw.fecha ?? raw.invoiceDate ?? "").trim();
  const invoiceDate = String(raw.invoiceDate ?? raw.fecha ?? "").trim();

  return {
    invoiceType,
    posNumber: String(raw.posNumber ?? raw.puntoVenta ?? "").trim() || undefined,
    invoiceNumber: String(raw.invoiceNumber ?? raw.numero ?? "").trim() || undefined,
    supplierCuit: normalizeCuitDigits(String(raw.supplierCuit ?? raw.cuit ?? "")),
    supplierName: String(raw.supplierName ?? raw.razonsocial ?? raw.proveedor ?? "").trim() || undefined,
    supplierVatCondition: coerceSupplierVatCondition(raw.supplierVatCondition),
    invoiceDate: invoiceDate || undefined,
    paymentDate: paymentDate || invoiceDate || undefined,
    totalAmount,
    netTaxedAmount: Number(raw.netTaxedAmount ?? raw.netoGravado ?? 0),
    vat21Amount: Number(raw.vat21Amount ?? raw.iva ?? 0),
    vat105Amount: Number(raw.vat105Amount ?? 0),
    vat27Amount: Number(raw.vat27Amount ?? 0),
    exemptAmount: Number(raw.exemptAmount ?? 0),
    vatPerceptionAmount: Number(raw.vatPerceptionAmount ?? 0),
    grossIncomePerceptionAmount: Number(raw.grossIncomePerceptionAmount ?? 0),
    otherTaxesAmount: Number(raw.otherTaxesAmount ?? raw.otrosImpuestos ?? 0),
    concepto: String(raw.concepto ?? "").trim() || "Gasto desde PDF",
    proveedor: String(raw.proveedor ?? raw.supplierName ?? raw.razonsocial ?? "").trim() || undefined,
    fecha: paymentDate || invoiceDate || new Date().toISOString().slice(0, 10),
    importe: totalAmount,
    medio: coerceMedio(raw.paymentMethod ?? raw.medio),
    observaciones: String(raw.observaciones ?? "").trim() || undefined,
    receiverCuit: receiverCuit || undefined,
    receiverName: String(raw.receiverName ?? "").trim() || undefined,
    issuedToCompany,
    isVatComputable: invoiceType === "factura_a" && issuedToCompany === true,
  };
}

export async function extractPagoFromPdf(params: { pdfBase64: string; filename: string }) {
  const model = getGenerativeModel(accountingPdfModel());
  const pdfData = pdfBase64Payload(params.pdfBase64);

  const prompt =
    "Sos un asistente contable. Analizá el PDF (comprobante de pago o factura de gasto). " +
    "Identificá fecha del gasto/pago, importe total, concepto breve, proveedor o beneficiario si aparece, y medio de pago más probable. " +
    "Fecha YYYY-MM-DD. Si no hay proveedor, cadena vacía. observaciones: texto corto opcional o vacío.\n\n" +
    PAGO_JSON_INSTRUCTION;

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: "application/pdf",
              data: pdfData,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
    },
  });

  const rawText = result.response.text()?.trim();
  if (!rawText) {
    throw new Error("El modelo no devolvió datos.");
  }
  const raw = parseModelJsonObject(rawText);
  return {
    fecha: String(raw.fecha ?? "").trim(),
    importe: Number(raw.importe ?? 0),
    concepto: String(raw.concepto ?? "").trim(),
    proveedor: String(raw.proveedor ?? "").trim() || undefined,
    medio: coerceMedio(raw.medio),
    observaciones: String(raw.observaciones ?? "").trim() || undefined,
  };
}

function parseMovimientosArray(raw: unknown): RawBankMovement[] {
  if (!Array.isArray(raw)) return [];
  const out: RawBankMovement[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const importe = Number(o.importe);
    if (!Number.isFinite(importe) || importe === 0) continue;
    out.push({
      fecha: String(o.fecha ?? "").trim(),
      importe,
      concepto: String(o.concepto ?? "").trim(),
      referenciaBanco: String(o.referenciaBanco ?? o.referencia ?? "").trim() || undefined,
      saldo: o.saldo != null && Number.isFinite(Number(o.saldo)) ? Number(o.saldo) : undefined,
      clasificacion: String(o.clasificacion ?? "").trim() || undefined,
    });
  }
  return out;
}

export async function extractBankExtractFromPdf(params: { pdfBase64: string; filename: string }) {
  const model = getGenerativeModel(accountingPdfModel());
  const pdfData = pdfBase64Payload(params.pdfBase64);

  const prompt =
    "Sos un asistente contable argentino. Analizá el PDF de extracto bancario / últimos movimientos de cuenta corriente. " +
    "Extraé cada línea de movimiento con fecha, importe con signo (crédito positivo, débito negativo), concepto y referencia. " +
    "Fechas en YYYY-MM-DD. Importes con punto decimal, sin símbolo $. " +
    "Si el PDF muestra importes con formato argentino (1.234,56), convertí a número JavaScript (1234.56). " +
    "clasificacion: cobro si es ingreso, pago si es egreso o comisión/impuesto, ignorar solo filas que no sean movimientos.\n\n" +
    EXTRACTO_BANCO_JSON_INSTRUCTION;

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: "application/pdf",
              data: pdfData,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
    },
  });

  const rawText = result.response.text()?.trim();
  if (!rawText) {
    throw new Error("El modelo no devolvió datos.");
  }
  const raw = parseModelJsonObject(rawText);
  return {
    cuentaNumero: String(raw.cuentaNumero ?? raw.cuenta ?? "").trim(),
    moneda: String(raw.moneda ?? "ARS").trim(),
    movimientos: parseMovimientosArray(raw.movimientos),
  };
}
