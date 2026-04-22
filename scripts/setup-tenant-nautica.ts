/**
 * Setup DEFINITIVO: crea/actualiza el tenant Náutica en Firestore.
 * Ejecutar UNA VEZ para que Náutica pueda registrar usuarios y RECIBIR mensajes.
 *
 * Uso:
 *   npx tsx scripts/setup-tenant-nautica.ts
 *   npx tsx scripts/setup-tenant-nautica.ts --webhook https://nauticadmin.../api/whatsapp/incoming
 *   npx tsx scripts/setup-tenant-nautica.ts --tenant-id nautica --name "Marinas del Yaguron"
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import path from "node:path";
import { existsSync } from "node:fs";
import crypto from "node:crypto";

const PROJECT_ID = "studio-3864746689-59018";

async function main() {
  const args = process.argv.slice(2);
  const tenantIdIdx = args.indexOf("--tenant-id");
  const nameIdx = args.indexOf("--name");
  const webhookIdx = args.indexOf("--webhook");

  const tenantId = tenantIdIdx >= 0 ? args[tenantIdIdx + 1] : "WZAf1Mw08Uq047wneIxI";
  const name = nameIdx >= 0 ? args[nameIdx + 1] : "Marinas del Yaguron";
  const webhookUrl = webhookIdx >= 0 ? args[webhookIdx + 1] : "";

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
  const ref = db.collection("tenants").doc(tenantId);
  const snap = await ref.get();

  let internalSecret: string;

  if (snap.exists) {
    const d = snap.data() as { internalSecret?: string; webhookUrl?: string };
    internalSecret = d?.internalSecret ?? crypto.randomBytes(24).toString("base64url");
    const updates: Record<string, unknown> = {};
    if (!d?.internalSecret) {
      updates.internalSecret = internalSecret;
      updates.referralTokens = ["NAUTICA", "YAGURON"];
      console.log("[OK] Tenant actualizado con internalSecret");
    } else {
      internalSecret = d.internalSecret;
    }
    if (webhookUrl) {
      updates.webhookUrl = webhookUrl;
      console.log("[OK] webhookUrl actualizado:", webhookUrl);
    }
    updates.name = name;
    updates.status = "active";
    if (Object.keys(updates).length > 0) {
      await ref.update(updates);
    } else {
      console.log("[OK] Tenant ya existe");
    }
  } else {
    internalSecret = crypto.randomBytes(24).toString("base64url");
    await ref.set({
      name,
      status: "active",
      referralTokens: ["NAUTICA", "YAGURON"],
      webhookUrl: webhookUrl || null,
      internalSecret,
    });
    console.log("[OK] Tenant creado");
  }

  console.log("\n=== CONFIGURACIÓN NÁUTICA ===\n");
  console.log("Tenant ID:", tenantId);
  console.log("INTERNAL_SECRET:", internalSecret);
  console.log("\nGuardá este secret en Náutica (env var o config).");
  console.log("\nPara registrar un usuario desde Náutica:");
  console.log(`
curl -X POST "https://notificashub--studio-3864746689-59018.us-east4.hosted.app/api/register-user" \\
  -H "Content-Type: application/json" \\
  -H "x-internal-token: ${internalSecret}" \\
  -d '{"phone":"5493364645357","tenantId":"${tenantId}"}'
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
