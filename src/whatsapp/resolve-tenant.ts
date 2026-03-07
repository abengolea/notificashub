/**
 * Algoritmo resolveTenant: determina a qué tenant enrutar el mensaje
 */
import type { Firestore } from "firebase-admin/firestore";
import type { IncomingMessage, ResolveAction, TenantOption } from "./types";
import {
  getMemberships,
  getSession,
  setSession,
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
/** Sesión y lastTenant expiran tras 5 min de inactividad → se vuelve a mostrar la lista */
const ACTIVITY_WINDOW_MS = 5 * 60 * 1000;
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

  // 2. interactiveChoiceId: "1", "2" o tenantId directo ("heartlink", "river")
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
    if (session?.activeTenantId && tenantIds.includes(session.activeTenantId)) {
      return { action: "route", tenantId: session.activeTenantId };
    }

    const lastTenant = await getLastTenant(db, phone);
    if (lastTenant?.tenantId && tenantIds.includes(lastTenant.tenantId)) {
      const storedIds = lastTenant.tenantIdsAtChoice;
      const isRecent = Date.now() - lastTenant.updatedAt.getTime() <= ACTIVITY_WINDOW_MS;
      if (storedIds && arraysEqualUnordered(storedIds, tenantIds) && isRecent) {
        return { action: "route", tenantId: lastTenant.tenantId };
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
    return { action: "ask_choice", options };
  }

  // 3. Un solo tenant: enrutar directo
  return { action: "route", tenantId: tenantIds[0] };
}
