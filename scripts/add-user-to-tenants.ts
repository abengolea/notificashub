/**
 * SOLUCIÓN DEFINITIVA: agrega un usuario a varios tenants de una vez.
 * Escritura directa a Firestore (sin API, sin tokens).
 *
 * Uso:
 *   npx tsx scripts/add-user-to-tenants.ts 5493364645357 heartlink WZAf1Mw08Uq047wneIxI
 *   npx tsx scripts/add-user-to-tenants.ts 3364645357 heartlink nautica
 *
 * Los tenantIds deben existir en Firestore (tenants/). El teléfono se normaliza a 549...
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldPath } from "firebase-admin/firestore";
import path from "node:path";
import { existsSync } from "node:fs";

const PROJECT_ID = "studio-3864746689-59018";

function sanitizePhone(phone: string): string {
  return phone.replace(/[^a-zA-Z0-9]/g, "_");
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length === 10 && !digits.startsWith("54")) {
    return "549" + digits;
  }
  return digits;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("Uso: npx tsx scripts/add-user-to-tenants.ts <phone> <tenantId1> [tenantId2] ...");
    console.error("Ejemplo: npx tsx scripts/add-user-to-tenants.ts 5493364645357 heartlink WZAf1Mw08Uq047wneIxI");
    process.exit(1);
  }

  const phoneInput = args[0];
  const tenantIds = args.slice(1);

  const credentialsPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ??
    path.join(process.cwd(), `${PROJECT_ID}-firebase-adminsdk-fbsvc-5cdc673866.json`);

  const hasCredentials =
    (process.env.GOOGLE_APPLICATION_CREDENTIALS && existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) ||
    (!process.env.GOOGLE_APPLICATION_CREDENTIALS && existsSync(credentialsPath));

  if (getApps().length === 0) {
    if (hasCredentials) {
      initializeApp({ credential: cert(credentialsPath), projectId: PROJECT_ID });
    } else {
      initializeApp({ projectId: PROJECT_ID });
    }
  }

  const db = getFirestore();
  const normalized = normalizePhone(phoneInput);
  const key = sanitizePhone(normalized);

  const ref = db.collection("user_memberships").doc(key);
  const snap = await ref.get();

  const now = new Date();
  const existing = (snap.data() as { tenantIds?: string[] })?.tenantIds ?? [];
  const merged = [...new Set([...existing, ...tenantIds])];

  await ref.set(
    {
      phone: normalized,
      tenantIds: merged,
      updatedAt: now,
    },
    { merge: true }
  );

  await db.collection("wa_last_tenant").doc(key).delete();

  const prefix = key + "_";
  const sessionsSnap = await db
    .collection("wa_sessions")
    .where(FieldPath.documentId(), ">=", prefix)
    .where(FieldPath.documentId(), "<=", prefix + "\uf8ff")
    .get();
  if (!sessionsSnap.empty) {
    const batch = db.batch();
    for (const doc of sessionsSnap.docs) batch.delete(doc.ref);
    await batch.commit();
  }

  console.log("[OK] Usuario configurado:");
  console.log("  phone:", normalized);
  console.log("  tenantIds:", merged);
  console.log("\nEl próximo mensaje de WhatsApp mostrará la lista para elegir.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
