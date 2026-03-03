/**
 * Core logic: procesa mensajes entrantes del webhook.
 * Framework-agnóstico (sin Next.js); usable en Cloud Functions/Run.
 * Recibe payload parseado y ejecuta: idempotencia → resolve → route/send.
 */
import type { Firestore } from "firebase-admin/firestore";
import { extractIncomingMessages, toIncomingMessage } from "./validate";
import { claimInboundMessage } from "./idempotency";
import { resolveTenantForIncomingMessage } from "./resolve-tenant";
import { getTenantInfo } from "./tenants";
import { sendText, sendInteractiveList } from "./sender";

export interface ProcessInboundResult {
  processed: number;
  duplicate: number;
  errors: string[];
}

export async function processInbound(
  db: Firestore,
  body: unknown
): Promise<ProcessInboundResult> {
  const result: ProcessInboundResult = { processed: 0, duplicate: 0, errors: [] };

  const extracted = extractIncomingMessages(body);

  for (const { message, from, contactName, value } of extracted) {
    const messageId = message.id;
    const pricingCategory = (value as { pricing?: { category?: string } })?.pricing?.category;

    try {
      // 1. Idempotencia: claim al recibir. Si ya existe → 200 OK, cortar sin procesar
      const claim = await claimInboundMessage(db, messageId, {
        phone: from,
        payload: message as unknown as Record<string, unknown>,
        pricingCategory,
      });

      if (!claim.claimed) {
        result.duplicate++;
        continue;
      }

      const incoming = toIncomingMessage(message, from);
      const resolveResult = await resolveTenantForIncomingMessage(db, from, incoming);

      if (resolveResult.action === "silent_unregistered") {
        result.processed++;
        continue;
      }

      if (resolveResult.action === "silent_or_handoff") {
        result.processed++;
        continue;
      }

      if (resolveResult.action === "ask_choice") {
        try {
          if (resolveResult.options.length === 1) {
            await sendText(from, `Te conectamos con: ${resolveResult.options[0].label}`);
          } else {
            await sendInteractiveList(
              from,
              "¿Por cuál servicio consultás?",
              "Elegí un número:",
              resolveResult.options
            );
          }
        } catch (err) {
          result.errors.push(`send ask_choice: ${err instanceof Error ? err.message : String(err)}`);
        }
        result.processed++;
        continue;
      }

      if (resolveResult.action === "route") {
        const tenant = await getTenantInfo(db, resolveResult.tenantId);
        if (tenant?.webhookUrl && tenant.internalSecret) {
          try {
            const res = await fetch(tenant.webhookUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-internal-token": tenant.internalSecret,
              },
              body: JSON.stringify({
                message,
                from,
                contactName,
                messageId,
                timestamp: message.timestamp,
              }),
            });
            if (!res.ok) {
              const text = await res.text();
              result.errors.push(`tenant ${resolveResult.tenantId}: ${res.status} ${text}`);
            }
          } catch (err) {
            result.errors.push(
              `tenant ${resolveResult.tenantId}: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        } else if (
          resolveResult.tenantId === "heartlink" &&
          process.env.HEARTLINK_URL &&
          process.env.INTERNAL_SECRET
        ) {
          try {
            const res = await fetch(`${process.env.HEARTLINK_URL}/api/whatsapp/incoming`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-internal-token": process.env.INTERNAL_SECRET,
              },
              body: JSON.stringify({
                message,
                from,
                contactName,
                messageId,
                timestamp: message.timestamp,
              }),
            });
            if (!res.ok) {
              const text = await res.text();
              result.errors.push(`heartlink: ${res.status} ${text}`);
            }
          } catch (err) {
            result.errors.push(`heartlink: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        result.processed++;
      }
    } catch (err) {
      result.errors.push(
        `message ${messageId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return result;
}
