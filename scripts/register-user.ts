/**
 * Registra un usuario en user_memberships de NotificasHub para que el router
 * le enrute a HeartLink (u otros tenants).
 *
 * Uso:
 *   npm run register-user -- 5493364645357
 *   npx tsx scripts/register-user.ts 5493364645357
 *
 * Requiere: GOOGLE_APPLICATION_CREDENTIALS con la ruta al JSON del service account
 * del proyecto studio-3864746689-59018 (o el archivo en la raíz del proyecto).
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import path from "node:path";
import { existsSync } from "node:fs";

const PROJECT_ID = "studio-3864746689-59018";

/** Misma función que usa el router (firestore.ts) */
function sanitizePhone(phone: string): string {
  return phone.replace(/[^a-zA-Z0-9]/g, "_");
}

const HEARTLINK_TENANT = {
  name: "HeartLink",
  status: "active",
  referralTokens: ["HEARTLINK", "HEART"],
  webhookUrl: "https://heartlink--heartlink-f4ftq.us-central1.hosted.app/api/whatsapp/incoming",
  internalSecret: "heartlink_internal_2026",
};

async function ensureHeartlinkTenant(db: ReturnType<typeof getFirestore>) {
  const ref = db.collection("tenants").doc("heartlink");
  const snap = await ref.get();

  if (snap.exists) {
    console.log("[OK] tenants/heartlink ya existe");
    return;
  }

  await ref.set(HEARTLINK_TENANT);
  console.log("[OK] tenants/heartlink creado");
}

async function registerUser(db: ReturnType<typeof getFirestore>, phone: string) {
  const key = sanitizePhone(phone);

  await db
    .collection("user_memberships")
    .doc(key)
    .set(
      {
        phone,
        tenantIds: ["heartlink"],
        updatedAt: new Date(),
      },
      { merge: true }
    );

  console.log(`[OK] user_memberships/${key} creado/actualizado`);
  console.log(`    phone: ${phone}`);
  console.log(`    tenantIds: ["heartlink"]`);
}

async function main() {
  const phone = process.argv[2]?.trim();
  if (!phone) {
    console.error("Uso: npx tsx scripts/register-user.ts <número>");
    console.error("Ejemplo: npx tsx scripts/register-user.ts 5493364645357");
    process.exit(1);
  }

  const credentialsPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ??
    path.join(process.cwd(), `${PROJECT_ID}-firebase-adminsdk-fbsvc-5cdc673866.json`);

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !existsSync(credentialsPath)) {
    console.error("Error: faltan credenciales.");
    console.error("Configurá GOOGLE_APPLICATION_CREDENTIALS con la ruta al JSON");
    console.error("del service account de studio-3864746689-59018, o colocá el archivo");
    console.error(`${PROJECT_ID}-firebase-adminsdk-fbsvc-5cdc673866.json en la raíz del proyecto.`);
    process.exit(1);
  }

  if (getApps().length === 0) {
    initializeApp({
      credential: cert(credentialsPath),
      projectId: PROJECT_ID,
    });
  }

  const db = getFirestore();

  console.log("Proyecto:", PROJECT_ID);
  console.log("Phone raw:", phone);
  console.log("Doc ID (sanitized):", sanitizePhone(phone));
  console.log("");

  await ensureHeartlinkTenant(db);
  await registerUser(db, phone);

  console.log("");
  console.log("Listo. Enviá un mensaje por WhatsApp para probar.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
