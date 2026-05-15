import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getFirestoreForWhatsappMail } from "@/lib/firebase-admin";

export type MetaMessageStatus = {
  id: string;
  status: string;
  recipient_id?: string;
  timestamp: string;
};

/** Claves de documento en `whatsapp_ids` a probar, en orden. */
export function whatsappIdsDocKeysForWamid(id: string): string[] {
  const trimmed = id.trim();
  if (!trimmed) return [];
  const keys = [trimmed];
  if (!trimmed.startsWith("wamid.")) {
    keys.push(`wamid.${trimmed}`);
  }
  return keys;
}

export function movementTypeForMetaStatus(
  status: string
): "whatsapp_delivered" | "whatsapp_read" | "whatsapp_failed" | null {
  const s = status.toLowerCase();
  if (s === "delivered") return "whatsapp_delivered";
  if (s === "read") return "whatsapp_read";
  if (s === "failed") return "whatsapp_failed";
  return null;
}

function metaUnixToTimestamp(ts: string): Timestamp {
  const sec = Number(ts);
  if (!Number.isFinite(sec) || sec <= 0) {
    return Timestamp.now();
  }
  return Timestamp.fromMillis(Math.floor(sec * 1000));
}

function movementDescription(
  movementType: string,
  recipientPhone: string
): string {
  if (movementType === "whatsapp_delivered") {
    return `Mensaje de WhatsApp entregado al teléfono +${recipientPhone}`;
  }
  if (movementType === "whatsapp_read") {
    return `Mensaje de WhatsApp leído en el teléfono +${recipientPhone}`;
  }
  if (movementType === "whatsapp_failed") {
    return `Error de entrega en WhatsApp para +${recipientPhone}`;
  }
  return `Estado WhatsApp: ${movementType}`;
}

function extractStatusesFromBody(body: unknown): MetaMessageStatus[] {
  const out: MetaMessageStatus[] = [];
  if (!body || typeof body !== "object") return out;
  const root = body as Record<string, unknown>;
  if (root.object !== "whatsapp_business_account") return out;

  const entries = root.entry;
  if (!Array.isArray(entries)) return out;

  for (const ent of entries) {
    if (!ent || typeof ent !== "object") continue;
    const changes = (ent as Record<string, unknown>).changes;
    if (!Array.isArray(changes)) continue;

    for (const ch of changes) {
      if (!ch || typeof ch !== "object") continue;
      if ((ch as Record<string, unknown>).field !== "messages") continue;

      const value = (ch as Record<string, unknown>).value;
      if (!value || typeof value !== "object") continue;

      const statuses = (value as Record<string, unknown>).statuses;
      if (!Array.isArray(statuses)) continue;

      for (const raw of statuses) {
        if (!raw || typeof raw !== "object") continue;
        const o = raw as Record<string, unknown>;
        const id = typeof o.id === "string" ? o.id : "";
        const status = typeof o.status === "string" ? o.status : "";
        const timestamp = typeof o.timestamp === "string" ? o.timestamp : "";
        const recipient_id =
          typeof o.recipient_id === "string" ? o.recipient_id : undefined;
        if (id && status && timestamp) {
          out.push({ id, status, recipient_id, timestamp });
        }
      }
    }
  }
  return out;
}

type WhatsappIdsDoc = {
  mailDocId?: string;
  recipientPhone?: string;
  createdAt?: unknown;
};

async function resolveMailDocId(
  db: Firestore,
  wamid: string
): Promise<string | null> {
  const col = db.collection("whatsapp_ids");
  for (const key of whatsappIdsDocKeysForWamid(wamid)) {
    const snap = await col.doc(key).get();
    if (!snap.exists) continue;
    const data = snap.data() as WhatsappIdsDoc | undefined;
    const mailDocId = data?.mailDocId;
    if (typeof mailDocId === "string" && mailDocId.length > 0) {
      return mailDocId;
    }
  }
  return null;
}

/** Formato alineado con Notificas (`functions/index.js` / panel de movimientos). */
type NotificasStyleMovement = {
  id: string;
  type: string;
  description: string;
  timestamp: string;
  userAgent: string;
  clientIP: string;
  forwardedIPs: string[];
  realIP: string;
  browser: string;
  recipientEmail: string;
  recipientPhone?: string;
  whatsappMessageId: string;
};

function movementExists(
  movements: unknown[],
  movementType: string,
  whatsappMessageId: string
): boolean {
  for (const m of movements) {
    if (!m || typeof m !== "object") continue;
    const o = m as Record<string, unknown>;
    if (
      o.type === movementType &&
      o.whatsappMessageId === whatsappMessageId
    ) {
      return true;
    }
  }
  return false;
}

function getMovementsArray(data: Record<string, unknown> | undefined): unknown[] {
  const tracking = data?.tracking;
  if (tracking && typeof tracking === "object") {
    const mov = (tracking as Record<string, unknown>).movements;
    if (Array.isArray(mov)) return mov;
  }
  return [];
}

/**
 * Aplica un único status de Meta al documento `mail/{mailDocId}`.
 * Debe llamarse dentro de un flujo que espere a que termine (no fire-and-forget).
 */
export async function applyMetaStatusToMailDoc(
  db: Firestore,
  mailDocId: string,
  st: MetaMessageStatus
): Promise<void> {
  const movementType = movementTypeForMetaStatus(st.status);
  if (!movementType) return;

  const wamid = st.id.trim();
  if (!wamid) return;

  const at = metaUnixToTimestamp(st.timestamp);
  const tsIso = at.toDate().toISOString();
  const recipientPhone = (st.recipient_id ?? "Unknown").replace(/^\+?/, "");
  const mailRef = db.collection("mail").doc(mailDocId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(mailRef);
    if (!snap.exists) return;

    const data = snap.data() as Record<string, unknown> | undefined;
    const movements = getMovementsArray(data);

    if (movementExists(movements, movementType, wamid)) {
      return;
    }

    const recipientEmail =
      typeof data?.recipientEmail === "string" && data.recipientEmail
        ? data.recipientEmail
        : "Unknown";

    const newMovement: NotificasStyleMovement = {
      id: randomUUID(),
      type: movementType,
      description: movementDescription(movementType, recipientPhone),
      timestamp: tsIso,
      userAgent: "WhatsApp Cloud API",
      clientIP: "Server",
      forwardedIPs: [],
      realIP: "Server",
      browser: "WhatsApp",
      recipientEmail,
      recipientPhone: st.recipient_id ?? undefined,
      whatsappMessageId: wamid,
    };

    const trackingPatch: Record<string, unknown> = {
      movements: FieldValue.arrayUnion(newMovement),
    };

    if (movementType === "whatsapp_delivered") {
      trackingPatch.whatsappDelivered = true;
      trackingPatch.whatsappDeliveredAt = FieldValue.serverTimestamp();
    } else if (movementType === "whatsapp_read") {
      trackingPatch.whatsappRead = true;
      trackingPatch.whatsappReadAt = FieldValue.serverTimestamp();
    } else if (movementType === "whatsapp_failed") {
      trackingPatch.whatsappFailedAt = FieldValue.serverTimestamp();
    }

    tx.set(mailRef, { tracking: trackingPatch }, { merge: true });
  });
}

/**
 * Procesa todos los `statuses` del payload: resuelve `mailDocId` y escribe en Firestore.
 * Errores por status se capturan en el caller.
 */
export async function processWhatsAppWebhookPayload(
  body: unknown,
  options?: { db?: Firestore }
): Promise<{ processed: number; skipped: number; errors: string[] }> {
  const statuses = extractStatusesFromBody(body);
  const db = options?.db ?? getFirestoreForWhatsappMail();
  let processed = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const st of statuses) {
    const movementType = movementTypeForMetaStatus(st.status);
    if (!movementType) {
      skipped += 1;
      continue;
    }

    try {
      const mailDocId = await resolveMailDocId(db, st.id);
      if (!mailDocId) {
        skipped += 1;
        console.warn(
          "[whatsapp-webhook] Sin whatsapp_ids para wamid=%s status=%s",
          st.id,
          st.status
        );
        continue;
      }
      await applyMetaStatusToMailDoc(db, mailDocId, st);
      processed += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`wamid=${st.id} status=${st.status}: ${msg}`);
      console.error("[whatsapp-webhook] Error procesando status:", msg, e);
    }
  }

  return { processed, skipped, errors };
}

export { extractStatusesFromBody };
