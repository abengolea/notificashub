/**
 * Persistencia Firestore para WhatsApp Router multi-tenant
 */
import type { Firestore } from "firebase-admin/firestore";
import { FieldPath } from "firebase-admin/firestore";
import type { TenantOption, UserMembershipDoc } from "./types";

const TENANTS = "tenants";
const USER_MEMBERSHIPS = "user_memberships";
const WA_SESSIONS = "wa_sessions";
const WA_MESSAGES = "wa_messages";
const WA_PENDING_CHOICES = "wa_pending_choices";
const WA_LAST_TENANT = "wa_last_tenant";

/** Sanitiza phone para usar como doc ID (reemplaza no-alfanuméricos por _) */
export function sanitizePhone(phone: string): string {
  return phone.replace(/[^a-zA-Z0-9]/g, "_");
}

/** Bucket de 24h para sessionKey cuando no hay conversationId */
function getDateBucket(timestampSeconds?: number): string {
  const d = timestampSeconds ? new Date(timestampSeconds * 1000) : new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/**
 * sessionKey: phone_conversationId o phone_YYYYMMDD
 */
export function getSessionKey(
  phone: string,
  conversationId: string | undefined,
  timestampSeconds?: number
): string {
  const sanitized = sanitizePhone(phone);
  if (conversationId) {
    return `${sanitized}_${conversationId}`;
  }
  return `${sanitized}_${getDateBucket(timestampSeconds)}`;
}

export async function getMemberships(
  db: Firestore,
  phone: string
): Promise<UserMembershipDoc | null> {
  const key = sanitizePhone(phone);
  const snap = await db.collection(USER_MEMBERSHIPS).doc(key).get();
  if (!snap.exists) return null;
  return snap.data() as UserMembershipDoc;
}

interface WaSessionData {
  phone: string;
  conversationId?: string;
  activeTenantId: string;
  state: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export async function getSession(
  db: Firestore,
  sessionKey: string
): Promise<WaSessionData | null> {
  const snap = await db.collection(WA_SESSIONS).doc(sessionKey).get();
  if (!snap.exists) return null;
  const d = snap.data();
  if (!d) return null;
  // Sesiones legacy sin expiresAt/updatedAt → tratar como expiradas
  if (d.expiresAt == null || d.updatedAt == null) return null;
  const expiresAt = toDate(d.expiresAt);
  if (expiresAt < new Date()) return null; // Sesión expirada
  const updatedAt = toDate(d.updatedAt);
  const ageMs = Date.now() - updatedAt.getTime();
  if (ageMs > 30 * 60 * 1000) return null; // Inactividad >30 min
  return {
    phone: d.phone,
    conversationId: d.conversationId,
    activeTenantId: d.activeTenantId,
    state: d.state,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
    expiresAt,
  };
}

function toDate(v: unknown): Date {
  if (v instanceof Date) return v;
  if (v && typeof v === "object" && "seconds" in v) {
    return new Date((v as { seconds: number }).seconds * 1000);
  }
  if (v && typeof v === "object" && "_seconds" in v) {
    return new Date((v as { _seconds: number })._seconds * 1000);
  }
  return new Date();
}

export async function setSession(
  db: Firestore,
  sessionKey: string,
  data: Omit<WaSessionData, "createdAt" | "updatedAt">
): Promise<void> {
  const now = new Date();
  const payload: Record<string, unknown> = {
    phone: data.phone,
    activeTenantId: data.activeTenantId,
    state: data.state,
    expiresAt: data.expiresAt,
    createdAt: now,
    updatedAt: now,
  };
  if (data.conversationId != null) {
    payload.conversationId = data.conversationId;
  }
  await db.collection(WA_SESSIONS).doc(sessionKey).set(payload, { merge: true });
}

export async function deleteSession(db: Firestore, sessionKey: string): Promise<void> {
  await db.collection(WA_SESSIONS).doc(sessionKey).delete();
}

interface WaPendingChoiceData {
  options: TenantOption[];
  createdAt: Date;
  expiresAt: Date;
  attempts: number;
}

export async function getPendingChoice(
  db: Firestore,
  phone: string
): Promise<WaPendingChoiceData | null> {
  const key = sanitizePhone(phone);
  const snap = await db.collection(WA_PENDING_CHOICES).doc(key).get();
  if (!snap.exists) return null;
  const d = snap.data();
  if (!d) return null;
  const expiresAt = toDate(d.expiresAt);
  if (expiresAt < new Date()) return null; // expirado
  return {
    options: d.options as TenantOption[],
    createdAt: toDate(d.createdAt),
    expiresAt,
    attempts: (d.attempts as number) ?? 0,
  };
}

/** TTL por defecto: 10 min (ventana corta para elegir) */
const PENDING_CHOICE_TTL_MIN = 10;

export async function setPendingChoice(
  db: Firestore,
  phone: string,
  options: TenantOption[],
  ttlMinutes = PENDING_CHOICE_TTL_MIN
): Promise<void> {
  const key = sanitizePhone(phone);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);
  await db.collection(WA_PENDING_CHOICES).doc(key).set({
    options,
    createdAt: now,
    expiresAt,
    attempts: 0,
  });
}

export async function incrementPendingAttempts(
  db: Firestore,
  phone: string
): Promise<number> {
  const key = sanitizePhone(phone);
  const ref = db.collection(WA_PENDING_CHOICES).doc(key);
  const snap = await ref.get();
  if (!snap.exists) return 0;
  const current = (snap.data()?.attempts as number) ?? 0;
  const next = current + 1;
  await ref.update({ attempts: next });
  return next;
}

export async function deletePendingChoice(
  db: Firestore,
  phone: string
): Promise<void> {
  const key = sanitizePhone(phone);
  await db.collection(WA_PENDING_CHOICES).doc(key).delete();
}

const LAST_TENANT_DAYS = 30;

export interface LastTenantRecord {
  tenantId: string;
  updatedAt: Date;
  /** Solo presente si fue elegido explícitamente en contexto multi-tenant */
  tenantIdsAtChoice?: string[];
}

export async function getLastTenant(
  db: Firestore,
  phone: string
): Promise<LastTenantRecord | null> {
  const key = sanitizePhone(phone);
  const snap = await db.collection(WA_LAST_TENANT).doc(key).get();
  if (!snap.exists) return null;
  const d = snap.data();
  if (!d) return null;
  const updatedAt = toDate(d.updatedAt);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LAST_TENANT_DAYS);
  if (updatedAt < cutoff) return null;
  return {
    tenantId: d.tenantId as string,
    updatedAt,
    tenantIdsAtChoice: d.tenantIdsAtChoice as string[] | undefined,
  };
}

/**
 * Guarda el último tenant elegido. Para multi-tenant, incluir tenantIdsAtChoice
 * para validar que la membresía no haya cambiado al leer.
 */
export async function setLastTenant(
  db: Firestore,
  phone: string,
  tenantId: string,
  tenantIdsAtChoice?: string[]
): Promise<void> {
  const key = sanitizePhone(phone);
  const now = new Date();
  const data: Record<string, unknown> = { tenantId, updatedAt: now };
  if (tenantIdsAtChoice?.length) {
    data.tenantIdsAtChoice = tenantIdsAtChoice;
  }
  await db.collection(WA_LAST_TENANT).doc(key).set(data, { merge: true });
}

/** Borra wa_last_tenant para un teléfono (ej. al agregar nuevo tenant) */
export async function clearLastTenant(db: Firestore, phone: string): Promise<void> {
  const key = sanitizePhone(phone);
  await db.collection(WA_LAST_TENANT).doc(key).delete();
}

/** Borra todas las wa_sessions de un teléfono (por prefijo phone_) */
export async function clearSessionsForPhone(db: Firestore, phone: string): Promise<void> {
  const prefix = sanitizePhone(phone) + "_";
  const snap = await db
    .collection(WA_SESSIONS)
    .where(FieldPath.documentId(), ">=", prefix)
    .where(FieldPath.documentId(), "<=", prefix + "\uf8ff")
    .get();
  const batch = db.batch();
  for (const doc of snap.docs) {
    batch.delete(doc.ref);
  }
  if (!snap.empty) await batch.commit();
}

