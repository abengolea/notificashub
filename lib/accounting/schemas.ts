import { z } from "zod";
import {
  INVOICE_TYPES,
  SUPPLIER_VAT_CONDITIONS,
  PAID_BY_OPTIONS,
  ACCOUNTING_CATEGORIES,
  TAX_SUBCATEGORIES,
  validateVatComputable,
} from "@/lib/accounting/pago-fiscal";

export const medioPagoSchema = z.enum(["transferencia", "efectivo", "cheque", "tarjeta", "otro"]);
export type MedioPago = z.infer<typeof medioPagoSchema>;

export const invoiceTypeSchema = z.enum(INVOICE_TYPES);
export type InvoiceType = z.infer<typeof invoiceTypeSchema>;

export const supplierVatConditionSchema = z.enum(SUPPLIER_VAT_CONDITIONS);
export type SupplierVatCondition = z.infer<typeof supplierVatConditionSchema>;

export const paidBySchema = z.enum(PAID_BY_OPTIONS);
export type PaidBy = z.infer<typeof paidBySchema>;

export const accountingCategorySchema = z.enum(ACCOUNTING_CATEGORIES);
export type AccountingCategory = z.infer<typeof accountingCategorySchema>;

export const taxSubcategorySchema = z.enum(TAX_SUBCATEGORIES);
export type TaxSubcategory = z.infer<typeof taxSubcategorySchema>;

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

const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .nullable();

const optionalAmount = z.number().finite().min(0).optional();

export const pagoFiscalFieldsSchema = z.object({
  invoiceType: invoiceTypeSchema.nullable().optional(),
  posNumber: z.string().max(16).optional(),
  invoiceNumber: z.string().max(64).optional(),
  supplierCuit: z.string().max(20).optional(),
  supplierName: z.string().max(256).optional(),
  supplierVatCondition: supplierVatConditionSchema.nullable().optional(),
  invoiceDate: optionalDate,
  paymentDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  totalAmount: optionalAmount,
  netTaxedAmount: optionalAmount,
  vat21Amount: optionalAmount,
  vat105Amount: optionalAmount,
  vat27Amount: optionalAmount,
  exemptAmount: optionalAmount,
  vatPerceptionAmount: optionalAmount,
  grossIncomePerceptionAmount: optionalAmount,
  otherTaxesAmount: optionalAmount,
  accountingCategory: accountingCategorySchema.nullable().optional(),
  taxSubcategory: taxSubcategorySchema.nullable().optional(),
  paymentMethod: medioPagoSchema.optional(),
  paidBy: paidBySchema.nullable().optional(),
  isVatComputable: z.boolean().optional(),
  isIncomeTaxDeductible: z.boolean().optional(),
  issuedToCompany: z.boolean().nullable().optional(),
  pdfStoragePath: z.string().max(512).nullable().optional(),
  notes: z.string().max(2000).optional(),
});

export const pagoBodySchema = z
  .object({
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    importe: z.number().finite().min(0),
    concepto: z.string().min(1).max(512),
    medio: medioPagoSchema.optional(),
    proveedor: z.string().max(256).optional(),
    facturaId: z.string().max(128).optional(),
    observaciones: z.string().max(2000).optional(),
  })
  .merge(pagoFiscalFieldsSchema)
  .superRefine((data, ctx) => {
    const invoiceType = data.invoiceType ?? null;
    const isVatComputable = data.isVatComputable === true;

    if (invoiceType != null && invoiceType !== "sin_comprobante") {
      if (!String(data.supplierName ?? data.proveedor ?? "").trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Razón social del proveedor es obligatoria cuando hay comprobante.",
          path: ["supplierName"],
        });
      }
    }

    if (invoiceType === "factura_a") {
      if (!String(data.posNumber ?? "").trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Punto de venta obligatorio para Factura A.",
          path: ["posNumber"],
        });
      }
      if (!String(data.invoiceNumber ?? "").trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Número de comprobante obligatorio para Factura A.",
          path: ["invoiceNumber"],
        });
      }
      if (!String(data.supplierCuit ?? "").replace(/\D/g, "").trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "CUIT del proveedor obligatorio para Factura A.",
          path: ["supplierCuit"],
        });
      }
      if (!data.invoiceDate?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Fecha del comprobante obligatoria para Factura A.",
          path: ["invoiceDate"],
        });
      }
    }

    const vatCheck = validateVatComputable({
      isVatComputable,
      invoiceType,
      supplierCuit: String(data.supplierCuit ?? ""),
      posNumber: String(data.posNumber ?? ""),
      invoiceNumber: String(data.invoiceNumber ?? ""),
      issuedToCompany: data.issuedToCompany ?? null,
      netTaxedAmount: data.netTaxedAmount ?? 0,
      vat21Amount: data.vat21Amount ?? 0,
      vat105Amount: data.vat105Amount ?? 0,
      vat27Amount: data.vat27Amount ?? 0,
    });

    if (!vatCheck.ok) {
      for (const reason of vatCheck.reasons) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: reason, path: ["isVatComputable"] });
      }
    }
  });

export type PagoBody = z.infer<typeof pagoBodySchema>;

export const deduccionCategoriaSchema = z.enum([
  "obra_social",
  "honorarios_medicos",
  "alquiler_vivienda",
  "donaciones",
  "seguro_vida",
  "aportes_jubilatorios",
  "otro",
]);
export type DeduccionCategoria = z.infer<typeof deduccionCategoriaSchema>;

export const deduccionBodySchema = z.object({
  year: z.number().int().min(2000).max(2100),
  categoria: deduccionCategoriaSchema,
  descripcion: z.string().min(1).max(512),
  importe: z.number().finite().min(0),
  fecha: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  notes: z.string().max(2000).optional(),
});
export type DeduccionBody = z.infer<typeof deduccionBodySchema>;

export const bienNaturalezaSchema = z.enum(["activo", "pasivo"]);
export type BienNaturaleza = z.infer<typeof bienNaturalezaSchema>;

export const bienTipoSchema = z.enum([
  "inmueble",
  "rodado",
  "cuenta_bancaria",
  "inversion",
  "participacion_societaria",
  "cripto",
  "otro",
]);
export type BienTipo = z.infer<typeof bienTipoSchema>;

export const bienBodySchema = z.object({
  year: z.number().int().min(2000).max(2100),
  naturaleza: bienNaturalezaSchema,
  tipo: bienTipoSchema,
  descripcion: z.string().min(1).max(512),
  valuacionFiscal: z.number().finite().min(0),
  notes: z.string().max(2000).optional(),
  pdfStoragePath: z.string().max(512).optional(),
});
export type BienBody = z.infer<typeof bienBodySchema>;
