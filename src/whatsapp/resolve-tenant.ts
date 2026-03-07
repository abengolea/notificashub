/**
 * Algoritmo resolveTenant: determina a qué tenant enrutar el mensaje
 */
import type { Firestore } from "firebase-admin/firestore";
import type { IncomingMessage, ResolveAction, TenantOption } from "./types";
import {
  getMemberships,
  getSession,
  setSession,
  deleteSession,
  getPendingChoice,
  setPendingChoice,
  incrementPendingAttempts,
  deletePendingChoice,
  getLastTenant,
  setLastTenant,
  getSessionKey,
} from "./firestore";
import {
  getTenantIdsByToken,
  buildTenantOptions,
} from "./tenants";

const MAX_ASK_CHOICE_ATTEMPTS = 2;
/** Sesión y lastTenant expiran tras 30 min de inactividad → se vuelve a mostrar la lista.
 *  5 min era muy corto: interrumpía conversaciones activas (usuario leyendo/esperando). */
const ACTIVITY_WINDOW_MS = 30 * 60 * 1000;
const SESSION_TTL_MS = ACTIVITY_WINDOW_MS;

function arraysEqualUnordered(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  return b.every((id) => sa.has(id));
}

function resolveChoiceFromPending(
  message: IncomingMessage,
  options: TenantOption[],
  tenantIds: string[]
): string | null {
  // 1. Índice numérico (texto "1" o interactive id "1")
  if (message.numericChoice != null && message.numericChoice >= 1 && message.numericChoice <= options.length) {
    const opt = options[message.numericChoice - 1];
    return tenantIds.includes(opt.tenantId) ? opt.tenantId : null;
  }

  // 2. interactiveChoiceId: "1", "2" o tenantId directo ("heartlink", "nautica")
  if (message.interactiveChoiceId) {
    const id = message.interactiveChoiceId.toLowerCase().trim();
    const byIndex = parseInt(id, 10);
    if (Number.isInteger(byIndex) && byIndex >= 1 && byIndex <= options.length) {
      const opt = options[byIndex - 1];
      return tenantIds.includes(opt.tenantId) ? opt.tenantId : null;
    }
    const byTenantId = options.find((o) => o.tenantId.toLowerCase() === id);
    return byTenantId && tenantIds.includes(byTenantId.tenantId) ? byTenantId.tenantId : null;
  }

  // 3. Match por texto/label (usuario copió "Marinas del Yaguron" o escribió "2" en medio de texto)
  if (message.textBody) {
    const text = message.textBody.toLowerCase().trim();
    for (const opt of options) {
      if (!tenantIds.includes(opt.tenantId)) continue;
      const label = (opt.label || "").toLowerCase();
      if (!label) continue;
      if (text.includes(label)) return opt.tenantId;
      const parts = label.split(/\s+/).filter((p) => p.length >= 4);
      if (parts.some((p) => text.includes(p))) return opt.tenantId;
    }
  }

  return null;
}

export async function resolveTenantForIncomingMessage(
  db: Firestore,
  phone: string,
  message: IncomingMessage
): Promise<ResolveAction> {
  const membership = await getMemberships(db, phone);

  if (!membership || !membership.tenantIds?.length) {
    return { action: "silent_unregistered" };
  }

  const tenantIds = membership.tenantIds;
  const timestampSec = parseInt(message.timestamp, 10);

  // 1. Referral token (wa.me?text=NAUTICA): intención explícita, enrutar directo
  if (message.referralToken) {
    const matches = await getTenantIdsByToken(db, message.referralToken);
    const match = matches.find((t) => tenantIds.includes(t.id));
    if (match) return { action: "route", tenantId: match.id };
  }

  // 2. Múltiples tenants: ask_choice, pero respetar elección previa (session/lastTenant)
  //    para no preguntar en cada mensaje.
  if (tenantIds.length > 1) {
    const conversationId = undefined;
    const sessionKey = getSessionKey(phone, conversationId, timestampSec);

    const session = await getSession(db, sessionKey);
    const now = new Date();
    // Doble verificación: expiresAt Y updatedAt (por sesiones antiguas sin expiresAt correcto)
    const expiredByExpiresAt = session && session.expiresAt < now;
    const ageSinceUpdate = session ? Date.now() - session.updatedAt.getTime() : 0;
    const expiredByUpdatedAt = session && ageSinceUpdate > ACTIVITY_WINDOW_MS;
    const sessionExpired = expiredByExpiresAt || expiredByUpdatedAt;
    if (session) {
      const ageMin = Math.round(ageSinceUpdate / 60000);
      if (sessionExpired) {
        console.log("[NotificasHub] Session expirada (inactividad >30min), mostrando lista. ageMin:", ageMin, "expiresAt:", session.expiresAt.toISOString());
        await deleteSession(db, sessionKey);
      } else {
        console.log("[NotificasHub] Session válida, ageMin desde selección:", ageMin);
      }
    }
    if (session?.activeTenantId && tenantIds.includes(session.activeTenantId) && !sessionExpired) {
      console.log("[NotificasHub] Route via session:", session.activeTenantId);
      return { action: "route", tenantId: session.activeTenantId };
    }

    const lastTenant = await getLastTenant(db, phone);
    if (lastTenant?.tenantId && tenantIds.includes(lastTenant.tenantId)) {
      const storedIds = lastTenant.tenantIdsAtChoice;
      const ageMs = Date.now() - lastTenant.updatedAt.getTime();
      const isRecent = ageMs <= ACTIVITY_WINDOW_MS;
      if (storedIds && arraysEqualUnordered(storedIds, tenantIds) && isRecent) {
        console.log("[NotificasHub] Route via lastTenant:", lastTenant.tenantId, "ageMin:", Math.round(ageMs / 60000));
        return { action: "route", tenantId: lastTenant.tenantId };
      }
      if (!isRecent) {
        console.log("[NotificasHub] lastTenant expirado (inactividad >30min), mostrando lista. ageMin:", Math.round(ageMs / 60000));
      }
    }

    const pending = await getPendingChoice(db, phone);
    if (pending) {
      const selectedId = resolveChoiceFromPending(message, pending.options, tenantIds);
      if (selectedId) {
        await deletePendingChoice(db, phone);
        await setSession(db, sessionKey, {
          phone,
          conversationId,
          activeTenantId: selectedId,
          state: "active",
          expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        });
        await setLastTenant(db, phone, selectedId, tenantIds);
        return { action: "route", tenantId: selectedId, fromPendingChoice: true };
      }
      const attempts = await incrementPendingAttempts(db, phone);
      if (attempts >= MAX_ASK_CHOICE_ATTEMPTS) {
        await deletePendingChoice(db, phone);
        return { action: "silent_or_handoff" };
      }
      return { action: "ask_choice", options: pending.options };
    }
    const options = await buildTenantOptions(db, tenantIds);
    await setPendingChoice(db, phone, options);
    console.log("[NotificasHub] → ask_choice (mostrando lista de opciones)");
    return { action: "ask_choice", options };
  }

  // 3. Un solo tenant: enrutar directo
  return { action: "route", tenantId: tenantIds[0] };
}
