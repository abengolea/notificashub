/**
 * Migración: registra usuarios existentes de cada app en NotificasHub.
 *
 * Modos:
 * 1) Desde JSON: npx tsx scripts/migrate-users-to-notificashub.ts --json ./users.json
 * 2) Desde Firestore: npx tsx scripts/migrate-users-to-notificashub.ts --firestore <projectId> --collection users --phone-field phone
 *
 * Requiere: NOTIFICASHUB_URL, TENANT_ID, INTERNAL_SECRET
 *
 * Ejemplo JSON (users.json):
 *   [{ "phone": "5493364645357" }, { "phone": "5491112345678" }]
 *
 * Ejemplo HeartLink (Firestore):
 *   NOTIFICASHUB_URL=https://notificashub--studio-3864746689-59018.us-east4.hosted.app \
 *   TENANT_ID=heartlink \
 *   INTERNAL_SECRET=heartlink_internal_2026 \
 *   npx tsx scripts/migrate-users-to-notificashub.ts --firestore heartlink-f4ftq --collection users --phone-field phone
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

const BASE_URL = process.env.NOTIFICASHUB_URL ?? "http://localhost:3000";
const TENANT_ID = process.env.TENANT_ID ?? "heartlink";
const INTERNAL_SECRET = process.env.INTERNAL_SECRET;

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").replace(/^0/, ""); // solo dígitos, sin cero inicial
}

async function registerPhone(phone: string): Promise<{ ok: boolean; error?: string }> {
  const normalized = normalizePhone(phone);
  if (!normalized) return { ok: false, error: "Phone vacío tras normalizar" };

  const res = await fetch(`${BASE_URL}/api/register-user`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-token": INTERNAL_SECRET!,
    },
    body: JSON.stringify({ phone: normalized, tenantId: TENANT_ID }),
  });

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `${res.status} ${text}` };
  }
  return { ok: true };
}

async function main() {
  const args = process.argv.slice(2);
  const jsonIdx = args.indexOf("--json");
  const firestoreIdx = args.indexOf("--firestore");
  const collectionIdx = args.indexOf("--collection");
  const phoneFieldIdx = args.indexOf("--phone-field");

  if (!INTERNAL_SECRET) {
    console.error("Error: INTERNAL_SECRET es requerido.");
    process.exit(1);
  }

  let phones: string[] = [];

  if (jsonIdx >= 0 && args[jsonIdx + 1]) {
    const filePath = path.resolve(args[jsonIdx + 1]);
    if (!existsSync(filePath)) {
      console.error("Error: archivo no encontrado:", filePath);
      process.exit(1);
    }
    const data = JSON.parse(readFileSync(filePath, "utf-8")) as Array<{ phone?: string }>;
    phones = data.map((u) => u.phone).filter((p): p is string => !!p && typeof p === "string");
    console.log(`[JSON] Leyendo ${phones.length} usuarios de ${filePath}`);
  } else if (firestoreIdx >= 0 && args[firestoreIdx + 1]) {
    const projectId = args[firestoreIdx + 1];
    const collection = collectionIdx >= 0 ? args[collectionIdx + 1] ?? "users" : "users";
    const phoneField = phoneFieldIdx >= 0 ? args[phoneFieldIdx + 1] ?? "phone" : "phone";

    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.error("Error: para --firestore necesitás GOOGLE_APPLICATION_CREDENTIALS");
      console.error("con credenciales del proyecto fuente (ej. heartlink-f4ftq).");
      process.exit(1);
    }

    if (getApps().length === 0) {
      initializeApp({
        credential: cert(process.env.GOOGLE_APPLICATION_CREDENTIALS!),
        projectId,
      });
    }

    const db = getFirestore();
    const snap = await db.collection(collection).get();

    for (const doc of snap.docs) {
      const d = doc.data();
      const p = d[phoneField];
      if (p && typeof p === "string") phones.push(p);
    }

    console.log(`[Firestore] Leyendo ${phones.length} usuarios de ${projectId}/${collection}`);
  } else {
    console.error("Uso:");
    console.error("  --json ./users.json");
    console.error("  --firestore <projectId> [--collection users] [--phone-field phone]");
    console.error("");
    console.error("Variables: NOTIFICASHUB_URL, TENANT_ID, INTERNAL_SECRET");
    process.exit(1);
  }

  if (phones.length === 0) {
    console.log("No hay usuarios para migrar.");
    return;
  }

  console.log(`Registrando en NotificasHub (${BASE_URL}) tenant=${TENANT_ID}...`);
  console.log("");

  let ok = 0;
  let fail = 0;

  for (const phone of phones) {
    const result = await registerPhone(phone);
    if (result.ok) {
      ok++;
      console.log(`  [OK] ${phone}`);
    } else {
      fail++;
      console.error(`  [FAIL] ${phone}: ${result.error}`);
    }
  }

  console.log("");
  console.log(`Listo: ${ok} ok, ${fail} fallidos`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
