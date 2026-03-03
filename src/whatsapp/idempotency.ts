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

    tx.set(ref, {
      direction: "in",
      phone: data.phone,
      payload: data.payload,
      createdAt: new Date(),
      ...(data.pricingCategory && { pricingCategory: data.pricingCategory }),
    });

    return { claimed: true, existing: false };
  });
}
