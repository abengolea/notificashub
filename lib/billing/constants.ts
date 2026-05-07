export const BILLING_CLIENTS_COLLECTION = "billing_recurrente_clients";

/** IVA ventas estándar servicios gravados (Factura A empresa a empresa). */
export const BILLING_IVA_ALICUOTA = 0.21;

/** Emisor Notificas SRL — texto fijo para mails y observaciones. */
export const BILLING_EMISOR = {
  razonSocial: "NOTIFICAS S. R. L.",
  domicilio: "Colón 12 Piso 1 — San Nicolás, Buenos Aires",
  cuit: "33717298689",
} as const;

export const BILLING_DEFAULT_PUNTO_VENTA = "00002";
