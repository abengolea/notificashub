/**
 * Diagnóstico: qué ve NotificasHub para un teléfono.
 * Busca user_memberships con distintas variantes del número (Meta envía con country code).
 *
 * Uso: npx tsx scripts/debug-phone.ts 3364645357
 *      npx tsx scripts/debug-phone.ts 5493364645357
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import path from "node:path";
import { existsSync } from "node:fs";

const PROJECT_ID = "studio-3864746689-59018";

function sanitizePhone(phone: string): string {
  return phone.replace(/[^a-zA-Z0-9]/g, "_");
}

/** Genera variantes posibles del número para buscar */
function phoneVariants(input: string): string[] {
  const digits = input.replace(/\D/g, "");
  const variants: string[] = [digits, sanitizePhone(input)];
  if (digits.startsWith("549") && digits.length > 10) {
    variants.push(digits.slice(3)); // sin 549 (Argentina)
  } else if (digits.length === 10 && !digits.startsWith("549")) {
    variants.push("549" + digits); // con 549
  }
  return [...new Set(variants)];
}

async function main() {
  const input = process.argv[2]?.trim();
  if (!input) {
    console.error("Uso: npx tsx scripts/debug-phone.ts <phone>");
    console.error("Ejemplo: npx tsx scripts/debug-phone.ts 3364645357");
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
      initializeApp({ credential: cert(credentialsPath), projectId: PROJECT_ID });
    } else {
      initializeApp({ projectId: PROJECT_ID });
    }
  }

  const db = getFirestore();

  // Meta envía wa_id = "5493364645357" (country code + número, sin +)
  const metaFormat = input.length <= 10 ? "549" + input.replace(/\D/g, "") : input.replace(/\D/g, "");
  const keyNotificasHub = sanitizePhone(metaFormat);
  console.log("\n=== Diagnóstico para", input, "===\n");
  console.log("Meta envía wa_id:", metaFormat);
  console.log("Clave que usa NotificasHub:", keyNotificasHub);
  console.log("");

  const variants = phoneVariants(input);
  console.log("Variantes buscadas:", variants.join(", "));
  console.log("");

  for (const v of variants) {
    const key = sanitizePhone(v);
    const snap = await db.collection("user_memberships").doc(key).get();
    if (snap.exists) {
      const d = snap.data() as { phone?: string; tenantIds?: string[]; updatedAt?: unknown };
      console.log(`  ✓ user_memberships/${key}:`);
      console.log(`      phone: ${d?.phone ?? "-"}`);
      console.log(`      tenantIds: ${JSON.stringify(d?.tenantIds ?? [])}`);
      console.log(`      → ${(d?.tenantIds?.length ?? 0) > 1 ? "MULTI-TENANT (debería ver lista)" : "SINGLE-TENANT (va directo a esa app)"}`);
      console.log("");
    }
  }

  // Buscar docs que contengan este número en cualquier parte (por si hay formato raro)
  const allSnap = await db.collection("user_memberships").get();
  const matching: Array<{ id: string; data: unknown }> = [];
  for (const doc of allSnap.docs) {
    const data = doc.data();
    const phone = String(data?.phone ?? "");
    const ids = variants.map((v) => v.replace(/\D/g, "")).filter(Boolean);
    if (ids.some((id) => phone.includes(id) || doc.id.includes(id))) {
      matching.push({ id: doc.id, data });
    }
  }

  if (matching.length > 0 && matching.length !== variants.length) {
    console.log("Otros docs que podrían corresponder:");
    for (const m of matching) {
      console.log(`  - user_memberships/${m.id}:`, JSON.stringify((m.data as { tenantIds?: string[] })?.tenantIds));
    }
    console.log("");
  }

  const mainDoc = await db.collection("user_memberships").doc(keyNotificasHub).get();
  if (!mainDoc.exists) {
    console.log("⚠ NO se encontró user_memberships con la clave que usa NotificasHub.");
    console.log("  Creá el doc con ID:", keyNotificasHub);
    console.log("  Y tenantIds que incluyan AMBOS: HeartLink y Náutica.");
    console.log("");
    console.log("  Ejemplo correcto:");
    console.log('  { "phone": "5493364645357", "tenantIds": ["heartlink-tenant-id", "WZAf1Mw08Uq047wneIxI"], "updatedAt": ... }');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
