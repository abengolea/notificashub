/**
 * VERIFICACIÓN DEFINITIVA
 * Comprueba que todo esté configurado para multi-tenant (HeartLink + Náutica).
 *
 * Uso: npm run verificar-setup
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import path from "node:path";
import { existsSync } from "node:fs";

const PROJECT_ID = "studio-3864746689-59018";
const TENANT_ID = "WZAf1Mw08Uq047wneIxI";

async function main() {
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
  const errors: string[] = [];
  const ok: string[] = [];

  console.log("\n=== Verificación setup multi-tenant ===\n");

  const tenantSnap = await db.collection("tenants").doc(TENANT_ID).get();
  if (!tenantSnap.exists) {
    errors.push(`tenants/${TENANT_ID} no existe. Ejecutá: npm run setup-nautica-definitivo -- --webhook "URL"`);
  } else {
    const t = tenantSnap.data() as { webhookUrl?: string; internalSecret?: string; name?: string };
    if (!t?.webhookUrl) {
      errors.push(`tenants/${TENANT_ID} no tiene webhookUrl. NotificasHub no puede reenviar a nauticadmin.`);
    } else {
      ok.push(`tenants/${TENANT_ID}: webhookUrl=${t.webhookUrl}`);
    }
    if (!t?.internalSecret) {
      errors.push(`tenants/${TENANT_ID} no tiene internalSecret.`);
    } else {
      ok.push(`tenants/${TENANT_ID}: internalSecret configurado`);
    }
  }

  const heartlinkSnap = await db.collection("tenants").doc("heartlink").get();
  if (heartlinkSnap.exists) {
    ok.push("HeartLink: tenant existe en Firestore");
  } else {
    ok.push("HeartLink: usa config env (HEARTLINK_URL + INTERNAL_SECRET) si existe en Firestore deploy");
  }

  if (errors.length > 0) {
    console.log("❌ Problemas:\n");
    errors.forEach((e) => console.log("   •", e));
    console.log("");
  }

  if (ok.length > 0) {
    console.log("✓ OK:\n");
    ok.forEach((o) => console.log("   •", o));
    console.log("");
  }

  console.log("---");
  if (errors.length > 0) {
    console.log("\nPara corregir: npm run setup-nautica-definitivo -- --webhook \"https://nauticadmin.../api/whatsapp/incoming\"");
    process.exit(1);
  }
  console.log("\n✓ Todo listo. Podés probar con un usuario multi-tenant.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
