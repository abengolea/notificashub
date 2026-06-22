import { FieldValue, Timestamp, type DocumentData, type Firestore } from "firebase-admin/firestore";
import { ACCOUNTING_COLLECTIONS } from "@/lib/accounting/constants";
import { dateOnlyToUtcMidday } from "@/lib/accounting/dates";
import { fechaFieldToUi, toIso } from "@/lib/accounting/serialize";
import {
  conceptoFromMpPayment,
  medioFromMpPayment,
  type MpPaymentRow,
} from "@/lib/mercadopago/payments-search";

export type MedioCobro = "transferencia" | "efectivo" | "cheque" | "tarjeta" | "otro";

export type CobroMpInput = {
  mercadopagoPaymentId: string;
  facturaId: string;
  fechaYmd: string;
  importe: number;
  concepto: string;
  medio?: MedioCobro;
  observaciones?: string;
};

export function formatFacturaVentaLabel(data: {
  tipoComprobante?: string;
  puntoVenta?: string;
  numero?: string;
}): string {
  const tipo = data.tipoComprobante ?? "B";
  const pv = (data.puntoVenta ?? "").replace(/\D/g, "").padStart(5, "0");
  const nro = (data.numero ?? "").replace(/\D/g, "").padStart(8, "0");
  return `${tipo} ${pv}-${nro}`;
}

export function observacionesCobroMpFactura(params: {
  facturaLabel: string;
  mercadopagoPaymentId: string;
  sourceLabel?: string;
}): string {
  const origen = params.sourceLabel ? ` · ${params.sourceLabel}` : "";
  return `Cobro automático · Factura ${params.facturaLabel} · MP #${params.mercadopagoPaymentId}${origen}`.slice(
    0,
    2000
  );
}

export function cobroFieldsFromMpFactura(input: CobroMpInput): Record<string, unknown> {
  return {
    empresa: "notificas_srl",
    fecha: Timestamp.fromDate(dateOnlyToUtcMidday(input.fechaYmd)),
    importe: input.importe,
    concepto: input.concepto.slice(0, 512),
    medio: input.medio ?? "tarjeta",
    facturaId: input.facturaId,
    mercadopagoPaymentId: input.mercadopagoPaymentId,
    observaciones: input.observaciones?.slice(0, 2000) ?? null,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

export async function findCobroByMercadoPagoPaymentId(
  db: Firestore,
  mercadopagoPaymentId: string
): Promise<{ id: string; data: DocumentData } | null> {
  const snap = await db
    .collection(ACCOUNTING_COLLECTIONS.cobros)
    .where("mercadopagoPaymentId", "==", mercadopagoPaymentId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0]!;
  return { id: doc.id, data: doc.data() };
}

export async function findFacturaBySourcePaymentId(
  db: Firestore,
  sourcePaymentId: string
): Promise<{ id: string; data: DocumentData } | null> {
  const snap = await db
    .collection(ACCOUNTING_COLLECTIONS.facturas)
    .where("sourcePaymentId", "==", sourcePaymentId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0]!;
  return { id: doc.id, data: doc.data() };
}

/** Idempotente: crea cobro vinculado a factura MP o completa facturaId si ya existía el cobro. */
export async function ensureCobroForMpFactura(
  db: Firestore,
  input: CobroMpInput
): Promise<{ cobroId: string; created: boolean; linkedFactura: boolean }> {
  const existing = await findCobroByMercadoPagoPaymentId(db, input.mercadopagoPaymentId);

  if (existing) {
    const updates: Record<string, unknown> = {};
    if (!existing.data.facturaId && input.facturaId) {
      updates.facturaId = input.facturaId;
    }
    if (Object.keys(updates).length > 0) {
      updates.updatedAt = FieldValue.serverTimestamp();
      await db.collection(ACCOUNTING_COLLECTIONS.cobros).doc(existing.id).update(updates);
      return { cobroId: existing.id, created: false, linkedFactura: true };
    }
    return { cobroId: existing.id, created: false, linkedFactura: Boolean(existing.data.facturaId) };
  }

  const ref = await db.collection(ACCOUNTING_COLLECTIONS.cobros).add({
    ...cobroFieldsFromMpFactura(input),
    createdAt: FieldValue.serverTimestamp(),
  });
  return { cobroId: ref.id, created: true, linkedFactura: true };
}

export function cobroInputFromFacturaVentaMp(factura: {
  id: string;
  data: DocumentData;
}): CobroMpInput | null {
  const mpId = String(factura.data.sourcePaymentId ?? "").trim();
  if (!mpId) return null;
  if (String(factura.data.tipo ?? "") !== "venta") return null;

  const fechaYmd = fechaFieldToUi(toIso(factura.data.fecha));
  if (!fechaYmd) return null;

  const importe = Number(factura.data.total);
  if (!Number.isFinite(importe) || importe <= 0) return null;

  const facturaLabel = formatFacturaVentaLabel({
    tipoComprobante: String(factura.data.tipoComprobante ?? "B"),
    puntoVenta: String(factura.data.puntoVenta ?? ""),
    numero: String(factura.data.numero ?? ""),
  });
  const sourceSystem = String(factura.data.sourceSystem ?? "");
  const sourceLabel =
    sourceSystem === "legalmev" ? "LegalMev" : sourceSystem === "notificas" ? "Notificas" : undefined;
  const obsLine = String(factura.data.observaciones ?? "")
    .split("\n")[0]
    ?.trim();
  const razon = String(factura.data.razonsocial ?? "").trim();
  const concepto = (obsLine || `Cobro MP #${mpId}${razon ? ` · ${razon}` : ""}`).slice(0, 512);

  return {
    mercadopagoPaymentId: mpId,
    facturaId: factura.id,
    fechaYmd,
    importe,
    concepto,
    medio: "tarjeta",
    observaciones: `${observacionesCobroMpFactura({
      facturaLabel,
      mercadopagoPaymentId: mpId,
      sourceLabel,
    })} · backfill histórico`.slice(0, 2000),
  };
}

export function cobroInputFromMpPaymentAndFactura(
  payment: MpPaymentRow,
  factura: { id: string; data: DocumentData },
  fechaYmd: string
): CobroMpInput {
  const mpId = String(payment.id);
  const facturaLabel = formatFacturaVentaLabel({
    tipoComprobante: String(factura.data.tipoComprobante ?? "B"),
    puntoVenta: String(factura.data.puntoVenta ?? ""),
    numero: String(factura.data.numero ?? ""),
  });
  const sourceSystem = String(factura.data.sourceSystem ?? "");
  const sourceLabel =
    sourceSystem === "legalmev" ? "LegalMev" : sourceSystem === "notificas" ? "Notificas" : undefined;

  return {
    mercadopagoPaymentId: mpId,
    facturaId: factura.id,
    fechaYmd,
    importe: Number(factura.data.total) || Number(payment.transaction_amount) || 0,
    concepto: conceptoFromMpPayment(payment),
    medio: medioFromMpPayment(payment),
    observaciones: observacionesCobroMpFactura({
      facturaLabel,
      mercadopagoPaymentId: mpId,
      sourceLabel,
    }),
  };
}
