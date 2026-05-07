import { z } from "zod";

export const medioPagoSchema = z.enum(["transferencia", "efectivo", "cheque", "tarjeta", "otro"]);
export type MedioPago = z.infer<typeof medioPagoSchema>;

export const tipoFacturaSchema = z.enum(["venta", "compra"]);
export const tipoComprobanteSchema = z.enum(["A", "B", "C", "credito_a", "credito_b", "credito_c", "otro"]);

export const facturaBodySchema = z.object({
  tipo: tipoFacturaSchema,
  numero: z.string().min(1).max(64),
  puntoVenta: z.string().max(16).optional(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha YYYY-MM-DD"),
  razonsocial: z.string().min(1).max(256),
  cuit: z
    .string()
    .max(20)
    .optional()
    .transform((s) => (s?.trim() ? s.trim() : undefined)),
  tipoComprobante: tipoComprobanteSchema.optional(),
  netoGravado: z.number().finite().min(0),
  iva: z.number().finite().min(0),
  otrosImpuestos: z.number().finite().min(0).optional(),
  total: z.number().finite().min(0),
  observaciones: z.string().max(2000).optional(),
  /** Idempotencia facturación recurrente hub: clientId|YYYY-MM */
  billingRecurrenteKey: z.string().max(64).optional(),
});

export const cobroBodySchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  importe: z.number().finite().min(0),
  concepto: z.string().min(1).max(512),
  medio: medioPagoSchema.optional(),
  facturaId: z.string().max(128).optional(),
  observaciones: z.string().max(2000).optional(),
});

export const pagoBodySchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  importe: z.number().finite().min(0),
  concepto: z.string().min(1).max(512),
  medio: medioPagoSchema.optional(),
  proveedor: z.string().max(256).optional(),
  facturaId: z.string().max(128).optional(),
  observaciones: z.string().max(2000).optional(),
});
