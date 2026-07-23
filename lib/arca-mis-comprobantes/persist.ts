import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import {
  DEFAULT_ACCOUNTING_ENTITY_ID,
  getAccountingEntity,
  type AccountingEntityId,
} from "@/lib/accounting/constants";
import { dateOnlyToUtcMidday } from "@/lib/accounting/dates";
import { pagoBodyToFirestore, pagoFirestoreWithTimestamps } from "@/lib/accounting/pago-persist";
import type { MisComprobanteRow } from "@/lib/arca-mis-comprobantes/parse";
import {
  emitidosToFacturaDraft,
  misComprobanteDedupeKey,
  recibidosToPagoDraft,
} from "@/lib/arca-mis-comprobantes/map";

async function existingKeys(collection: string, keys: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  // Firestore 'in' max 30
  for (let i = 0; i < keys.length; i += 30) {
    const chunk = keys.slice(i, i + 30);
    if (!chunk.length) continue;
    const snap = await db.collection(collection).where("arcaMisComprobantesKey", "in", chunk).get();
    for (const d of snap.docs) {
      const k = d.data().arcaMisComprobantesKey;
      if (typeof k === "string") found.add(k);
    }
  }
  return found;
}

export type MisImportResult = {
  importedPagos: number;
  importedFacturas: number;
  skippedDuplicates: number;
  errors: string[];
};

export async function persistMisComprobantes(
  rows: MisComprobanteRow[],
  entityId: AccountingEntityId = DEFAULT_ACCOUNTING_ENTITY_ID
): Promise<MisImportResult> {
  const entity = getAccountingEntity(entityId);
  const recibidos = rows.filter((r) => r.kind === "recibido");
  const emitidos = rows.filter((r) => r.kind === "emitido");
  const result: MisImportResult = {
    importedPagos: 0,
    importedFacturas: 0,
    skippedDuplicates: 0,
    errors: [],
  };

  if (recibidos.length) {
    const keys = recibidos.map(misComprobanteDedupeKey);
    const existing = await existingKeys(entity.collections.pagos, keys);
    for (const row of recibidos) {
      const key = misComprobanteDedupeKey(row);
      if (existing.has(key)) {
        result.skippedDuplicates += 1;
        continue;
      }
      try {
        const draft = recibidosToPagoDraft(row);
        const { arcaMisComprobantesKey, cae, ...pagoFields } = draft;
        const body = pagoBodyToFirestore({
          ...pagoFields,
          fecha: draft.paymentDate,
          importe: draft.totalAmount,
        });
        const paymentDateTs = Timestamp.fromDate(dateOnlyToUtcMidday(draft.paymentDate));
        await db.collection(entity.collections.pagos).add({
          empresa: entity.empresa,
          ...pagoFirestoreWithTimestamps(body, paymentDateTs),
          arcaMisComprobantesKey,
          cae,
          source: "mis_comprobantes",
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        existing.add(key);
        result.importedPagos += 1;
      } catch (e) {
        result.errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  }

  if (emitidos.length) {
    const keys = emitidos.map(misComprobanteDedupeKey);
    const existing = await existingKeys(entity.collections.facturas, keys);
    for (const row of emitidos) {
      const key = misComprobanteDedupeKey(row);
      if (existing.has(key)) {
        result.skippedDuplicates += 1;
        continue;
      }
      try {
        const draft = emitidosToFacturaDraft(row);
        await db.collection(entity.collections.facturas).add({
          empresa: entity.empresa,
          tipo: draft.tipo,
          numero: draft.numero,
          puntoVenta: draft.puntoVenta,
          fecha: Timestamp.fromDate(dateOnlyToUtcMidday(draft.fecha)),
          razonsocial: draft.razonsocial,
          cuit: draft.cuit ?? null,
          tipoComprobante: draft.tipoComprobante,
          netoGravado: draft.netoGravado,
          iva: draft.iva,
          otrosImpuestos: draft.otrosImpuestos,
          total: draft.total,
          observaciones: draft.observaciones,
          arcaMisComprobantesKey: draft.arcaMisComprobantesKey,
          cae: draft.cae,
          source: "mis_comprobantes",
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        existing.add(key);
        result.importedFacturas += 1;
      } catch (e) {
        result.errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  }

  return result;
}
