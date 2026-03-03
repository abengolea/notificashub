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
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

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

  // 1. Inferir tenant por referral/text prefijado (tenant registry)
  if (message.referralToken) {
    const matches = await getTenantIdsByToken(db, message.referralToken);
    const match = matches.find((t) => tenantIds.includes(t.id));
    if (match) return { action: "route", tenantId: match.id };
  }

  // 2. Sesión activa en ventana 24h
  const conversationId = undefined;
  const sessionKey = getSessionKey(phone, conversationId, timestampSec);
  const session = await getSession(db, sessionKey);
  if (session?.activeTenantId && tenantIds.includes(session.activeTenantId)) {
    return { action: "route", tenantId: session.activeTenantId };
  }

  // 3. wa_last_tenant ≤ 30 días (vence lógico, no TTL real)
  const lastTenant = await getLastTenant(db, phone);
  if (lastTenant?.tenantId && tenantIds.includes(lastTenant.tenantId)) {
    return { action: "route", tenantId: lastTenant.tenantId };
  }

  // 4. Un solo tenant: enrutar directo
  if (tenantIds.length === 1) {
    return { action: "route", tenantId: tenantIds[0] };
  }

  // 5. Múltiples tenants: pending choice o crear uno
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
      await setLastTenant(db, phone, selectedId);
      return { action: "route", tenantId: selectedId };
    }

    const attempts = await incrementPendingAttempts(db, phone);
    if (attempts >= MAX_ASK_CHOICE_ATTEMPTS) {
      await deletePendingChoice(db, phone);
      return { action: "silent_or_handoff" };
    }

    return { action: "ask_choice", options: pending.options };
  }

  // 6. Crear ask_choice (tenant registry para labels)
  const options = await buildTenantOptions(db, tenantIds);
  await setPendingChoice(db, phone, options);
  return { action: "ask_choice", options };
}
