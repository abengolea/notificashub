/**
 * SETUP DEFINITIVO NÁUTICA
 * Ejecutar UNA VEZ. Crea tenant en Firestore con webhookUrl e internalSecret.
 * Sin webhookUrl, NotificasHub no puede reenviar mensajes a nauticadmin.
 *
 * Uso:
 *   npm run setup-nautica-definitivo -- --webhook https://nauticadmin-xxx.web.app/api/whatsapp/incoming
 *
 * Requiere: URL de nauticadmin donde recibe mensajes WhatsApp (endpoint tipo /api/whatsapp/incoming)
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import path from "node:path";
import { existsSync } from "node:fs";
import crypto from "node:crypto";

const PROJECT_ID = "studio-3864746689-59018";
const TENANT_ID = "WZAf1Mw08Uq047wneIxI";

async function main() {
  const args = process.argv.slice(2);
  const webhookIdx = args.indexOf("--webhook");
  const webhookUrl = webhookIdx >= 0 ? args[webhookIdx + 1]?.trim() : "";

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
  const snap = await ref.get();

  let internalSecret: string;

  if (snap.exists) {
    const d = snap.data() as { internalSecret?: string; webhookUrl?: string };
    internalSecret = (d?.internalSecret ?? crypto.randomBytes(24).toString("base64url")) as string;
    const updates: Record<string, unknown> = {
      name: "Marinas del Yaguron",
      status: "active",
      referralTokens: ["NAUTICA", "YAGURON"],
      internalSecret: d?.internalSecret ?? internalSecret,
    };
    if (webhookUrl) updates.webhookUrl = webhookUrl;
    else if (!d?.webhookUrl) updates.webhookUrl = null;
    await ref.set(updates, { merge: true });
    internalSecret = (d?.internalSecret ?? internalSecret) as string;
    console.log(webhookUrl ? "[OK] Tenant actualizado con webhookUrl" : "[OK] Tenant actualizado");
  } else {
    internalSecret = crypto.randomBytes(24).toString("base64url");
    await ref.set({
      name: "Marinas del Yaguron",
      status: "active",
      referralTokens: ["NAUTICA", "YAGURON"],
      webhookUrl: webhookUrl || null,
      internalSecret,
    });
    console.log("[OK] Tenant creado");
  }

  console.log("\n" + "=".repeat(60));
  console.log("CONFIGURACIÓN DEFINITIVA NÁUTICA");
  console.log("=".repeat(60) + "\n");

  console.log("1. En nauticadmin (.env.local o variables de entorno):\n");
  console.log("   NOTIFICASHUB_URL=https://notificashub--studio-3864746689-59018.us-east4.hosted.app");
  console.log(`   INTERNAL_SECRET=${internalSecret}\n`);

  console.log("2. Tenant en Firestore (ya configurado):");
  console.log(`   tenants/${TENANT_ID}`);
  console.log(`   - webhookUrl: ${webhookUrl || "(no configurado - agregar cuando tengas URL nauticadmin)"}`);
  console.log(`   - internalSecret: configurado\n`);
  if (!webhookUrl) {
    console.log("   Para agregar webhook después: npm run setup-nautica-definitivo -- --webhook \"https://...\"\n");
  }

  console.log("3. nauticadmin debe tener un endpoint que reciba POST en:");
  console.log(`   ${webhookUrl}`);
  console.log("   Con header x-internal-token con el INTERNAL_SECRET.\n");

  console.log("4. Para agregar usuario a HeartLink + Náutica:");
  console.log("   npm run add-user-to-tenants -- 5493364645357 heartlink " + TENANT_ID + "\n");

  console.log("=".repeat(60) + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
