/**
 * Limpia wa_last_tenant y wa_sessions legacy para usuarios multi-tenant.
 *
 * Cuando un usuario tiene 2+ tenantIds pero wa_last_tenant no tiene tenantIdsAtChoice,
 * el router ignora ese registro y muestra ask_choice. Este script BORRA esos docs
 * legacy para evitar consultas innecesarias y dejar la DB limpia.
 *
 * Opcionalmente limpia wa_sessions para que el próximo mensaje pase por ask_choice.
 *
 * Uso:
 *   GOOGLE_APPLICATION_CREDENTIALS=ruta/al/archivo.json npx tsx scripts/cleanup-legacy-last-tenant.ts
 *
 * Opciones:
 *   --dry-run    Solo muestra qué se borraría, sin ejecutar
 *   --sessions   También borra wa_sessions (por defecto solo wa_last_tenant)
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
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const clearSessions = args.includes("--sessions");

  const credentialsPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ??
    path.join(process.cwd(), `${PROJECT_ID}-firebase-adminsdk-fbsvc-5cdc673866.json`);

  const hasCredentialsFile =
    (process.env.GOOGLE_APPLICATION_CREDENTIALS && existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) ||
    (!process.env.GOOGLE_APPLICATION_CREDENTIALS && existsSync(credentialsPath));

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS && !existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }

  if (getApps().length === 0) {
    if (hasCredentialsFile) {
      const pathToUse = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? credentialsPath;
      initializeApp({ credential: cert(pathToUse), projectId: PROJECT_ID });
    } else {
      console.log("Usando gcloud ADC (gcloud auth application-default login)...");
      initializeApp({ projectId: PROJECT_ID });
    }
  }

  const db = getFirestore();

  if (dryRun) {
    console.log("Modo --dry-run: no se borrará nada\n");
  }

  // 1. Usuarios multi-tenant (2+ tenantIds)
  const membershipsSnap = await db.collection("user_memberships").get();
  const multiTenantPhones: Array<{ key: string; phone: string; tenantIds: string[] }> = [];

  for (const doc of membershipsSnap.docs) {
    const data = doc.data() as { phone?: string; tenantIds?: string[] };
    const tenantIds = data?.tenantIds ?? [];
    if (tenantIds.length > 1) {
      const phone = data.phone ?? doc.id;
      multiTenantPhones.push({ key: doc.id, phone, tenantIds });
    }
  }

  console.log(`Usuarios multi-tenant: ${multiTenantPhones.length}\n`);

  let lastTenantDeleted = 0;
  let sessionsDeleted = 0;

  for (const { key, phone, tenantIds } of multiTenantPhones) {
    const lastTenantSnap = await db.collection("wa_last_tenant").doc(key).get();
    if (!lastTenantSnap.exists) continue;

    const d = lastTenantSnap.data() as { tenantId?: string; tenantIdsAtChoice?: string[] };
    const hasTenantIdsAtChoice = Array.isArray(d?.tenantIdsAtChoice) && d.tenantIdsAtChoice.length > 0;

    if (!hasTenantIdsAtChoice) {
      console.log(`  [wa_last_tenant] ${phone} (${tenantIds.join(", ")}) → legacy, sin tenantIdsAtChoice`);
      if (!dryRun) {
        await db.collection("wa_last_tenant").doc(key).delete();
        lastTenantDeleted++;
      }
    }

    if (clearSessions) {
      const prefix = sanitizePhone(phone) + "_";
      const sessionsSnap = await db
        .collection("wa_sessions")
        .where(FieldPath.documentId(), ">=", prefix)
        .where(FieldPath.documentId(), "<=", prefix + "\uf8ff")
        .get();

      if (!sessionsSnap.empty) {
        console.log(`  [wa_sessions] ${phone} → ${sessionsSnap.size} sesiones`);
        if (!dryRun) {
          const batch = db.batch();
          for (const doc of sessionsSnap.docs) {
            batch.delete(doc.ref);
          }
          await batch.commit();
          sessionsDeleted += sessionsSnap.size;
        }
      }
    }
  }

  console.log("\n---");
  if (dryRun) {
    console.log("Ejecutá sin --dry-run para aplicar los cambios.");
  } else {
    console.log(`Listo: ${lastTenantDeleted} wa_last_tenant borrados${clearSessions ? `, ${sessionsDeleted} wa_sessions borradas` : ""}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
