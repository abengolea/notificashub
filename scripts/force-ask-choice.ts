/**
 * Fuerza ask_choice en el próximo mensaje borrando wa_last_tenant y wa_sessions
 * para un teléfono específico.
 *
 * Uso:
 *   npx tsx scripts/force-ask-choice.ts 5493364645357
 *
 * Requiere GOOGLE_APPLICATION_CREDENTIALS o archivo de credenciales en la raíz.
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldPath } from "firebase-admin/firestore";
import path from "node:path";
import { existsSync } from "node:fs";

const PROJECT_ID = "studio-3864746689-59018";

function sanitizePhone(phone: string): string {
  return phone.replace(/[^a-zA-Z0-9]/g, "_");
}

async function main() {
  const phone = process.argv[2]?.trim();
  if (!phone) {
    console.error("Uso: npx tsx scripts/force-ask-choice.ts <phone>");
    console.error("Ejemplo: npx tsx scripts/force-ask-choice.ts 5493364645357");
    process.exit(1);
  }

  const credentialsPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ??
    path.join(process.cwd(), `${PROJECT_ID}-firebase-adminsdk-fbsvc-5cdc673866.json`);

  const hasCredentials =
    (process.env.GOOGLE_APPLICATION_CREDENTIALS && existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) ||
    (!process.env.GOOGLE_APPLICATION_CREDENTIALS && existsSync(credentialsPath));

  if (getApps().length === 0) {
    if (hasCredentials) {
      const pathToUse = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? credentialsPath;
      initializeApp({ credential: cert(pathToUse), projectId: PROJECT_ID });
    } else {
      console.log("Usando gcloud ADC...");
      initializeApp({ projectId: PROJECT_ID });
    }
  }

  const db = getFirestore();
  const key = sanitizePhone(phone);

  await db.collection("wa_last_tenant").doc(key).delete();
  console.log(`[OK] wa_last_tenant borrado para ${phone}`);

  const prefix = key + "_";
  const snap = await db
    .collection("wa_sessions")
    .where(FieldPath.documentId(), ">=", prefix)
    .where(FieldPath.documentId(), "<=", prefix + "\uf8ff")
    .get();

  if (!snap.empty) {
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    console.log(`[OK] ${snap.size} wa_sessions borradas para ${phone}`);
  }

  console.log("\nListo. El próximo mensaje de WhatsApp mostrará la lista para elegir tenant.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
