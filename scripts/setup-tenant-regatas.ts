/**
 * Crea o actualiza tenants/regatas para integración con Regatas+.
 *
 * Uso:
 *   GOOGLE_APPLICATION_CREDENTIALS=ruta.json npx tsx scripts/setup-tenant-regatas.ts
 *   npx tsx scripts/setup-tenant-regatas.ts --webhook https://otra-base/api/whatsapp/incoming
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import path from "node:path";
import { existsSync } from "node:fs";

const PROJECT_ID = "studio-3864746689-59018";
const TENANT_ID = "regatas";

const DEFAULT_DOC = {
  name: "Regatas+",
  status: "active",
  referralTokens: ["REGATAS", "REGATAS+"],
  webhookUrl:
    "https://gestion-regatas--regatasadmin-3c6ee.us-east4.hosted.app/api/whatsapp/incoming",
  internalSecret: "regatas_internal_2026",
  internalAuthHeader: "x-internal-secret",
  webhookPayloadFormat: "regatas_plus" as const,
};

async function main() {
  const args = process.argv.slice(2);
  const webhookIdx = args.indexOf("--webhook");
  const webhookOverride = webhookIdx >= 0 ? args[webhookIdx + 1]?.trim() : "";

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
  const ref = db.collection("tenants").doc(TENANT_ID);
  const payload = {
    ...DEFAULT_DOC,
    ...(webhookOverride ? { webhookUrl: webhookOverride } : {}),
  };
  await ref.set(payload, { merge: true });

  console.log("[OK] Firestore tenants/regatas actualizado.\n");
  console.log(JSON.stringify(payload, null, 2));
  console.log(
    "\nRegistrá usuarios con: npm run add-user-to-tenants -- <teléfono> regatas [otros-tenants...]"
  );
  console.log(
    "\nImágenes (regatas_plus): definí FIREBASE_STORAGE_BUCKET en NotificasHub para URLs firmadas."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
