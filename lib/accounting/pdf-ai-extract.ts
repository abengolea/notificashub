import OpenAI from "openai";
import { medioPagoSchema, tipoComprobanteSchema } from "@/lib/accounting/schemas";

const FACTURA_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    numero: { type: "string" },
    puntoVenta: { type: "string" },
    fecha: { type: "string", description: "YYYY-MM-DD" },
    razonsocial: { type: "string" },
    cuit: { type: "string" },
    tipoComprobante: {
      type: "string",
      enum: ["A", "B", "C", "credito_a", "credito_b", "credito_c", "otro"],
    },
    netoGravado: { type: "number" },
    iva: { type: "number" },
    otrosImpuestos: { type: "number" },
    total: { type: "number" },
    observaciones: { type: "string" },
  },
  required: [
    "numero",
    "puntoVenta",
    "fecha",
    "razonsocial",
    "cuit",
    "tipoComprobante",
    "netoGravado",
    "iva",
    "otrosImpuestos",
    "total",
    "observaciones",
  ],
} as const;

const PAGO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    fecha: { type: "string", description: "YYYY-MM-DD" },
    importe: { type: "number" },
    concepto: { type: "string" },
    proveedor: { type: "string" },
    medio: {
      type: "string",
      enum: ["transferencia", "efectivo", "cheque", "tarjeta", "otro"],
    },
    observaciones: { type: "string" },
  },
  required: ["fecha", "importe", "concepto", "proveedor", "medio", "observaciones"],
} as const;

function getClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error("Falta OPENAI_API_KEY en el entorno del servidor.");
  }
  return new OpenAI({ apiKey: key });
}

function modelo(): string {
  return process.env.ACCOUNTING_PDF_AI_MODEL?.trim() || "gpt-4o";
}

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
  const openai = getClient();
  const response = await openai.responses.create({
    model: modelo(),
    instructions:
      "Sos un asistente contable para Argentina (AFIP/comprobantes). Leé el PDF y extraé únicamente lo pedido.",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              `Analizá el PDF adjunto. El usuario clasificó el comprobante como libro ${params.tipoLibro} (` +
              (params.tipoLibro === "venta"
                ? "factura emitida / ventas — IVA débito"
                : "factura recibida / compras — IVA crédito") +
              `). Devolvé los campos del esquema. Fecha siempre ISO YYYY-MM-DD. Importes en número (punto decimal). ` +
              `tipoComprobante: A/B/C o nota de crédito (credito_a/b/c) u otro. Si un dato no figura, usá cadena vacía o 0 según corresponda.`,
          },
          {
            type: "input_file",
            filename: params.filename || "documento.pdf",
            file_data: params.pdfBase64,
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "factura_extract",
        strict: true,
        schema: FACTURA_SCHEMA,
      },
    },
  });

  if (response.error) {
    throw new Error(response.error.message ?? "Error del modelo al leer el PDF.");
  }
  const rawText = response.output_text?.trim();
  if (!rawText) {
    throw new Error("El modelo no devolvió datos.");
  }
  const raw = JSON.parse(rawText) as Record<string, unknown>;
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
  const openai = getClient();
  const response = await openai.responses.create({
    model: modelo(),
    instructions:
      "Sos un asistente contable. Leé el comprobante de pago o factura de gasto y extraé los campos del esquema.",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "Identificá fecha del gasto/pago, importe total pagado o adeudado, concepto breve, proveedor o beneficiario si aparece, y medio de pago más probable. " +
              "Fecha YYYY-MM-DD. Si no hay proveedor, cadena vacía. observaciones: texto corto opcional o vacío.",
          },
          {
            type: "input_file",
            filename: params.filename || "documento.pdf",
            file_data: params.pdfBase64,
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "pago_extract",
        strict: true,
        schema: PAGO_SCHEMA,
      },
    },
  });

  if (response.error) {
    throw new Error(response.error.message ?? "Error del modelo al leer el PDF.");
  }
  const rawText = response.output_text?.trim();
  if (!rawText) {
    throw new Error("El modelo no devolvió datos.");
  }
  const raw = JSON.parse(rawText) as Record<string, unknown>;
  return {
    fecha: String(raw.fecha ?? "").trim(),
    importe: Number(raw.importe ?? 0),
    concepto: String(raw.concepto ?? "").trim(),
    proveedor: String(raw.proveedor ?? "").trim() || undefined,
    medio: coerceMedio(raw.medio),
    observaciones: String(raw.observaciones ?? "").trim() || undefined,
  };
}
