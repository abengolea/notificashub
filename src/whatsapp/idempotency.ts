/**
 * Idempotencia: evita duplicados cuando Meta reintenta webhooks.
 * Guardar wa_messages al recibir; si ya existe, cortar sin procesar.
 */
import type { Firestore } from "firebase-admin/firestore";

const WA_MESSAGES = "wa_messages";

export interface ClaimResult {
  claimed: boolean;
  /** true = mensaje nuevo, proseguir. false = duplicado, cortar. */
  existing: boolean;
}

/**
 * Intenta "reclamar" el mensaje: crea wa_messages/{messageId} si no existe.
 * Usar transacción para evitar race en reintentos simultáneos.
 * @returns { claimed: true } si es nuevo (guardado); { claimed: false, existing: true } si duplicado
 */
export async function claimInboundMessage(
  db: Firestore,
  messageId: string,
  data: {
    phone: string;
    payload: Record<string, unknown>;
    pricingCategory?: string;
  }
): Promise<ClaimResult> {
  const ref = db.collection(WA_MESSAGES).doc(messageId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      return { claimed: false, existing: true };
    }

    // Firestore no acepta undefined. Guardar solo campos esenciales; JSON.parse/stringify elimina undefined.
    const p = data.payload;
    const obj: Record<string, unknown> = {
      id: p.id,
      from: p.from,
      timestamp: p.timestamp,
      type: p.type,
    };
    if (p.text) obj.text = p.text;
    if (p.interactive) obj.interactive = p.interactive;
    if (p.context) obj.context = p.context;
    if (p.referral) obj.referral = p.referral;
    const payload = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;

    const doc: Record<string, unknown> = {
      direction: "in",
      phone: data.phone,
      payload,
      createdAt: new Date(),
    };
    if (data.pricingCategory) doc.pricingCategory = data.pricingCategory;
    tx.set(ref, doc);

    return { claimed: true, existing: false };
  });
}
