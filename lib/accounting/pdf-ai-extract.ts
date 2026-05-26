import {
  accountingPdfModel,
  getGenerativeModel,
  parseModelJsonObject,
  pdfBase64Payload,
} from "@/lib/ai/google-gemini";
import type { RawBankMovement } from "@/lib/accounting/bank-extract";
import { medioPagoSchema, tipoComprobanteSchema } from "@/lib/accounting/schemas";

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

const PAGO_JSON_INSTRUCTION = `Respondé SOLO un objeto JSON válido (sin markdown) con exactamente estas claves y tipos:
{
  "fecha": string (YYYY-MM-DD),
  "importe": number,
  "concepto": string,
  "proveedor": string,
  "medio": "transferencia"|"efectivo"|"cheque"|"tarjeta"|"otro",
  "observaciones": string
}`;

function normalizeCuitDigits(s: string): string | undefined {
  const d = String(s ?? "")
    .replace(/\D/g, "")
    .slice(0, 11);
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
    cuit: normalizeCuitDigits(String(raw.cuit ?? "")),
    tipoComprobante: coerceTipoComprobante(raw.tipoComprobante),
    netoGravado: Number(raw.netoGravado ?? 0),
    iva: Number(raw.iva ?? 0),
    otrosImpuestos: Number(raw.otrosImpuestos ?? 0),
    total: Number(raw.total ?? 0),
    observaciones: String(raw.observaciones ?? "").trim() || undefined,
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
