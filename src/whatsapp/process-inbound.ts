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
import { downloadMediaFromMeta, getMediaIdFromMessage } from "./media-download";

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
        const tenantName = tenant?.name ?? resolveResult.tenantId;
        // Log para depuración: contacto compartido (médico solicitante)
        const hasContacts = !!(message as { contacts?: unknown[] }).contacts?.length ||
          !!(message as { contact?: unknown }).contact;
        if (hasContacts) {
          console.log("[NotificasHub] Reenviando mensaje con contacto compartido:", {
            messageId,
            to: tenant?.webhookUrl ?? "heartlink",
            contactsCount: (message as { contacts?: unknown[] }).contacts?.length ?? 0,
          });
        }
        let forwarded = false;
        const basePayload: Record<string, unknown> = {
          message,
          from,
          contactName,
          messageId,
          timestamp: message.timestamp,
          tenantId: resolveResult.tenantId,
          type: message.type,
        };

        // Para document/image/video: SIEMPRE base64. NauticAdmin no tiene token de Meta.
        const mediaId = getMediaIdFromMessage(message);
        const isMediaMessage = mediaId && (message.type === "document" || message.type === "image" || message.type === "video");
        if (message.type === "image" || message.type === "document") {
          console.log("[NotificasHub] Mensaje type:", message.type, "mediaId:", mediaId ?? "null", "isMediaMessage:", isMediaMessage);
        }
        if (isMediaMessage) {
          console.log("[NotificasHub] Media recibida, type:", message.type, "mediaId:", mediaId);
          const media = await downloadMediaFromMeta(mediaId!);
          if (!media) {
            console.warn("[NotificasHub] No se pudo descargar media para reenviar a tenant:", messageId);
            try {
              await sendText(
                from,
                "No pudimos procesar el archivo. Por favor intentá de nuevo enviando la imagen, PDF o video."
              );
            } catch (sendErr) {
              result.errors.push(
                `fallback media error: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`
              );
            }
            result.processed++;
            continue;
          }
          if (message.type === "document") {
            basePayload.documentBase64 = media.base64;
            basePayload.documentMimeType = media.mimeType ?? "application/pdf";
            if (media.filename) basePayload.documentFilename = media.filename;
            (message as Record<string, unknown>).document = { ...(message.document || {}), base64: media.base64 };
          } else if (message.type === "image") {
            basePayload.imageBase64 = media.base64;
            (message as Record<string, unknown>).image = { ...(message.image || {}), base64: media.base64 };
            console.log("[NotificasHub] imageBase64 añadido, length:", media.base64.length);
          } else {
            basePayload.videoBase64 = media.base64;
            if (media.mimeType) basePayload.videoMimeType = media.mimeType;
            (message as Record<string, unknown>).video = { ...(message.video || {}), base64: media.base64 };
          }
        }

        if (!tenant?.webhookUrl || !tenant.internalSecret) {
          console.warn("[NotificasHub] Tenant sin webhookUrl o internalSecret, no se puede reenviar:", resolveResult.tenantId, "webhookUrl:", !!tenant?.webhookUrl);
        }
        if (tenant?.webhookUrl && tenant.internalSecret) {
          if (isMediaMessage) {
            console.log("[NotificasHub] Reenviando a tenant con media, payload keys:", Object.keys(basePayload));
          }
          try {
            const res = await fetch(tenant.webhookUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-internal-token": tenant.internalSecret,
              },
              body: JSON.stringify(basePayload),
            });
            if (!res.ok) {
              const text = await res.text();
              console.warn("[NotificasHub] POST a tenant falló:", res.status, resolveResult.tenantId, text.slice(0, 200));
              result.errors.push(`tenant ${resolveResult.tenantId}: ${res.status} ${text}`);
            } else {
              forwarded = true;
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
            const heartlinkPayload = { ...basePayload, tenantId: "heartlink" as const };
            const res = await fetch(`${process.env.HEARTLINK_URL}/api/whatsapp/incoming`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-internal-token": process.env.INTERNAL_SECRET,
              },
              body: JSON.stringify(heartlinkPayload),
            });
            if (!res.ok) {
              const text = await res.text();
              result.errors.push(`heartlink: ${res.status} ${text}`);
            } else {
              forwarded = true;
            }
          } catch (err) {
            result.errors.push(`heartlink: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        // Si no pudimos reenviar (sin webhook o falló), enviamos fallback para que el usuario no quede sin respuesta
        if (!forwarded) {
          console.warn(
            `[NotificasHub] No se pudo reenviar a ${resolveResult.tenantId}: ` +
              (tenant?.webhookUrl ? "webhook falló" : "webhookUrl no configurado")
          );
          try {
            await sendText(
              from,
              `Te conectamos con ${tenantName}. Si no recibís respuesta en unos minutos, escribinos de nuevo.`
            );
          } catch (sendErr) {
            result.errors.push(
              `fallback send: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`
            );
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
