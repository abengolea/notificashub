/**
 * Crea o actualiza tenants/{tenantId} para la app Planes de ahorro (webhook formato meta).
 *
 * El id del documento debe coincidir con NOTIFICASHUB_TENANT_ID en planesdeahorro.
 * NOTIFICASHUB_INBOUND_SECRET en planesdeahorro debe ser idéntico a internalSecret (no commitear).
 *
 * Uso:
 *   GOOGLE_APPLICATION_CREDENTIALS=ruta.json npx tsx scripts/setup-tenant-planesdeahorro.ts \
 *     --webhook https://staging.ejemplo.com/api/whatsapp/incoming
 *
 *   npx tsx scripts/setup-tenant-planesdeahorro.ts \
 *     --tenant-id planesdeahorro \
 *     --name "Planes de ahorro / Dr. Bengolea" \
 *     --webhook https://prod.ejemplo.com/api/whatsapp/incoming \
 *     --phone 5491112345678
 *
 * Opcional:
 *   --secret <valor>     fijar internalSecret (mismo que NOTIFICASHUB_INBOUND_SECRET en planesdeahorro)
 *   --auth-header <name> ej. x-internal-token (default del hub si omitís el campo en Firestore)
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import path from "node:path";
import { existsSync } from "node:fs";
import crypto from "node:crypto";

const PROJECT_ID = "studio-3864746689-59018";

const DEFAULT_TENANT_ID = "planesdeahorro";
const DEFAULT_NAME = "Planes de ahorro";
const DEFAULT_REFERRAL_TOKENS = ["PLANES", "PLANESDEAHORRO", "EVAL"];

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  return args[i + 1]?.trim();
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

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
  const tenantId = argValue(args, "--tenant-id") ?? DEFAULT_TENANT_ID;
  const name = argValue(args, "--name") ?? DEFAULT_NAME;
  let webhookUrl = argValue(args, "--webhook");
  const secretOverride = argValue(args, "--secret");
  const authHeader = argValue(args, "--auth-header");
  const phoneOpt = argValue(args, "--phone");

  if (!webhookUrl) {
    console.error("Falta --webhook con la URL absoluta de POST /api/whatsapp/incoming (sin barra final).");
    console.error(
      "Ejemplo: npx tsx scripts/setup-tenant-planesdeahorro.ts --webhook https://dominio.com/api/whatsapp/incoming"
    );
    process.exit(1);
  }
  webhookUrl = stripTrailingSlash(webhookUrl);

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
  if (secretOverride) {
    internalSecret = secretOverride;
  } else if (snap.exists) {
    const d = snap.data() as { internalSecret?: string };
    internalSecret = d?.internalSecret ?? crypto.randomBytes(24).toString("base64url");
  } else {
    internalSecret = crypto.randomBytes(24).toString("base64url");
  }

  const payload: Record<string, unknown> = {
    name,
    status: "active",
    referralTokens: DEFAULT_REFERRAL_TOKENS,
    webhookUrl,
    internalSecret,
    webhookPayloadFormat: "meta",
  };

  if (authHeader?.length) {
    payload.internalAuthHeader = authHeader;
  }

  await ref.set(payload, { merge: true });

  console.log("\n[OK] Firestore tenants/" + tenantId + " listo.\n");
  console.log("=== Planes de ahorro ↔ NotificasHub ===\n");
  console.log("NOTIFICASHUB_TENANT_ID (planesdeahorro):", tenantId);
  console.log("NOTIFICASHUB_INBOUND_SECRET: <mismo valor que internalSecret en Firestore>");
  console.log("\ninternalSecret (copiar a env seguro de planesdeahorro, no a git):\n");
  console.log(internalSecret);
  console.log("\nDeep link sugerido (referral):");
  console.log(`  https://wa.me/<NUMERO_HUB>?text=PLANES`);
  console.log(`  https://wa.me/<NUMERO_HUB>?text=PLANESDEAHORRO`);
  console.log("\nMembresía: el teléfono del usuario debe estar en user_memberships con tenantIds que incluya:");
  console.log('  "' + tenantId + '"');
  if (phoneOpt) {
    const normalized = normalizePhone(phoneOpt);
    const key = sanitizePhone(normalized);
    const mRef = db.collection("user_memberships").doc(key);
    const mSnap = await mRef.get();
    const existing = (mSnap.data() as { tenantIds?: string[] })?.tenantIds ?? [];
    const merged = [...new Set([...existing, tenantId])];
    await mRef.set(
      {
        phone: normalized,
        tenantIds: merged,
        updatedAt: new Date(),
      },
      { merge: true }
    );
    console.log("\n[OK] user_memberships/" + key + " tenantIds →", merged);
  } else {
    console.log("\nRegistrar un número de prueba:");
    console.log(`  npm run add-user-to-tenants -- 549... ${tenantId}`);
  }
  console.log("\nPrueba de envío desde planesdeahorro al hub:");
  console.log(`  POST {NOTIFICASHUB_URL}/api/whatsapp/send`);
  console.log(`  Headers: x-internal-token: <mismo secret>, body: { "to": "549...", "text": "...", "tenantId": "${tenantId}" }`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
