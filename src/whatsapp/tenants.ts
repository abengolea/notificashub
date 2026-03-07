/**
 * Tenant registry: mapea tokens (RIVER, NAUTICA) a tenantId y labels.
 * Config hardcodeada inicial; Firestore tenants/ como fuente principal.
 */
import type { Firestore } from "firebase-admin/firestore";
import type { TenantDoc, TenantOption } from "./types";

/** Config hardcodeada para tenants conocidos (fallback si Firestore vacío) */
export const HARDCODED_TENANTS: Record<
  string,
  { name: string; referralTokens?: string[]; webhookUrl?: string; internalSecret?: string }
> = {
  heartlink: {
    name: "HeartLink",
    referralTokens: ["HEARTLINK", "HEART"],
    webhookUrl: process.env.HEARTLINK_URL
      ? `${process.env.HEARTLINK_URL}/api/whatsapp/incoming`
      : undefined,
    internalSecret: process.env.INTERNAL_SECRET,
  },
  river: {
    name: "Escuela River",
    referralTokens: ["RIVER", "ESCUELA_RIVER"],
  },
  nautica: {
    name: "Náutica",
    referralTokens: ["NAUTICA", "YAGURON"],
    internalSecret: process.env.NAUTICA_INTERNAL_SECRET,
  },
};

export interface TenantInfo {
  id: string;
  name: string;
  referralTokens: string[];
  webhookUrl?: string;
  internalSecret?: string;
}

/**
 * Obtiene tenant por ID (Firestore primero, luego hardcoded)
 */
export async function getTenantInfo(
  db: Firestore,
  tenantId: string
): Promise<TenantInfo | null> {
  const snap = await db.collection("tenants").doc(tenantId).get();
  if (snap.exists) {
    const d = snap.data() as TenantDoc;
    return {
      id: snap.id,
      name: d.name,
      referralTokens: d.referralTokens ?? [],
      webhookUrl: d.webhookUrl,
      internalSecret: d.internalSecret,
    };
  }

  const hard = HARDCODED_TENANTS[tenantId];
  if (hard) {
    return {
      id: tenantId,
      name: hard.name,
      referralTokens: hard.referralTokens ?? [],
      webhookUrl: hard.webhookUrl,
      internalSecret: hard.internalSecret,
    };
  }

  return null;
}

/**
 * Mapea token a tenantIds (Firestore + hardcoded)
 */
export async function getTenantIdsByToken(
  db: Firestore,
  token: string
): Promise<Array<{ id: string; name: string }>> {
  const normalized = token.toUpperCase().trim();
  const result: Array<{ id: string; name: string }> = [];

  // Firestore
  const tenantsSnap = await db.collection("tenants").get();
  for (const doc of tenantsSnap.docs) {
    const d = doc.data() as TenantDoc;
    const tokens = (d.referralTokens ?? []).map((t) => t.toUpperCase().trim());
    if (tokens.includes(normalized)) {
      result.push({ id: doc.id, name: d.name });
    }
  }

  // Hardcoded (si no hay match en Firestore o como complemento)
  for (const [id, config] of Object.entries(HARDCODED_TENANTS)) {
    const tokens = (config.referralTokens ?? []).map((t) => t.toUpperCase().trim());
    if (tokens.includes(normalized) && !result.some((r) => r.id === id)) {
      result.push({ id, name: config.name });
    }
  }

  return result;
}

/**
 * Convierte tenantIds a TenantOption[] con labels
 */
export async function buildTenantOptions(
  db: Firestore,
  tenantIds: string[]
): Promise<TenantOption[]> {
  const options: TenantOption[] = [];
  for (let i = 0; i < tenantIds.length; i++) {
    const info = await getTenantInfo(db, tenantIds[i]);
    options.push({
      index: i + 1,
      tenantId: tenantIds[i],
      label: info?.name ?? tenantIds[i],
    });
  }
  return options;
}
