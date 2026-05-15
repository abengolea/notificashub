import { z } from "zod";

export const ivaCondicionClienteSchema = z.enum([
  "responsable_inscripto",
  "monotributo",
  "exento",
  "consumidor_final",
  "no_categorizado",
]);

export type IvaCondicionCliente = z.infer<typeof ivaCondicionClienteSchema>;

export const billingClientBodySchema = z.object({
  active: z.boolean().optional().default(true),
  razonSocial: z.string().min(1).max(256),
  cuit: z.string().min(10).max(14),
  ivaCondicion: ivaCondicionClienteSchema,
  domicilio: z.string().min(1).max(512),
  emailFacturacion: z.string().email().max(256),
  mensualidadUsd: z.number().finite().positive().max(1_000_000),
  condicionVenta: z.string().max(128).optional().default("Transferencia bancaria"),
  tipoComprobanteDefault: z.enum(["A", "B", "C"]).optional().default("A"),
  /** Texto libre del ítem (servicio mensual). */
  descripcionServicio: z.string().min(1).max(2000).optional().default(
    "Servicio mensual de plataforma / soporte conforme contrato.",
  ),
});

export const billingClientPatchSchema = billingClientBodySchema.partial();

export const billingPreviewBodySchema = z.object({
  clientId: z.string().min(1).max(128),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Si viene, se usa en lugar de la API pública. */
  arsPorUsdManual: z.number().finite().positive().optional(),
});

export const billingIssueBodySchema = z.object({
  clientId: z.string().min(1).max(128),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  numero: z.string().min(1).max(64),
  puntoVenta: z.string().max(16).optional(),
  arsPorUsdManual: z.number().finite().positive().optional(),
  enviarEmail: z.boolean().optional().default(false),
});

export const billingVerifyAiBodySchema = z.object({
  clientRazonSocial: z.string().min(1),
  cuit: z.string().min(1),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  usd: z.number().finite().positive(),
  arsPorUsd: z.number().finite().positive(),
  netoGravado: z.number().finite().min(0),
  iva: z.number().finite().min(0),
  total: z.number().finite().min(0),
  fuenteTipoCambio: z.string().min(1),
});
