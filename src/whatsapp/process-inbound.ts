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

  // Diagnóstico: contar mensajes en TODO el body (todos los entry/changes) vs extraídos
  let rawMsgTotal = 0;
  let firstRawMsg: { type?: string } | null = null;
  const entries = (body as { entry?: { changes?: { value?: { messages?: unknown[] } }[] }[] })?.entry ?? [];
  for (const entry of entries) {
    for (const change of entry?.changes ?? []) {
      const msgs = change?.value?.messages ?? [];
      rawMsgTotal += msgs.length;
      if (msgs.length > 0 && !firstRawMsg) {
        firstRawMsg = msgs[0] as { type?: string };
      }
    }
  }
  if (rawMsgTotal > 0 && extracted.length === 0) {
    console.warn("[NotificasHub] Mensajes en payload pero extractIncomingMessages=0:", {
      rawMsgTotal,
      firstMsgType: firstRawMsg?.type,
      firstMsgKeys: firstRawMsg ? Object.keys(firstRawMsg as object) : [],
    });
  } else if (extracted.length > 0) {
    const first = extracted[0].message;
    if (first.type === "image" || first.type === "document" || first.type === "sticker") {
      console.log("[NotificasHub] extractIncomingMessages: media OK", { count: extracted.length, type: first.type });
    }
  }

  for (const { message, from, contactName, value } of extracted) {
    const messageId = message.id;
    const pricingCategory = (value as { pricing?: { category?: string } })?.pricing?.category;
    const isImageType = message.type === "image" || message.type === "document" || message.type === "sticker" || message.type === "video";

    if (isImageType) {
      console.log("[msg] received", { id: messageId, type: message.type, from, hasImage: !!message.image, hasDocument: !!message.document });
    }

    try {
      // 1. Idempotencia: claim al recibir. Si ya existe → 200 OK, cortar sin procesar
      const claim = await claimInboundMessage(db, messageId, {
        phone: from,
        payload: message as unknown as Record<string, unknown>,
        pricingCategory,
      });

      if (!claim.claimed) {
        if (isImageType) console.log("[msg] early-exit", { id: messageId, step: "duplicate" });
        result.duplicate++;
        continue;
      }

      const incoming = toIncomingMessage(message, from);
      if (isImageType) {
        console.log("[msg] after-extract", { id: messageId, type: incoming.type });
      }
      const resolveResult = await resolveTenantForIncomingMessage(db, from, incoming);

      if (resolveResult.action === "silent_unregistered") {
        if (isImageType) console.log("[msg] early-exit", { id: messageId, step: "silent_unregistered" });
        result.processed++;
        continue;
      }

      if (resolveResult.action === "silent_or_handoff") {
        if (isImageType) console.log("[msg] early-exit", { id: messageId, step: "silent_or_handoff" });
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

        // Para document/image/video/sticker: SIEMPRE base64. NauticAdmin no tiene token de Meta.
        const mediaId = getMediaIdFromMessage(message);
        const isMediaMessage = mediaId && (message.type === "document" || message.type === "image" || message.type === "video" || message.type === "sticker");
        if (isImageType && !mediaId) {
          console.log("[msg] early-exit", { id: messageId, step: "missing-media-id", type: message.type });
          try {
            await sendText(from, "No pudimos obtener el archivo. Por favor intentá de nuevo.");
          } catch (sendErr) {
            result.errors.push(`fallback missing-media: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`);
          }
          result.processed++;
          continue;
        }
        if (isMediaMessage) {
          console.log("[msg] before-media-download", { id: messageId, mediaId, type: message.type });
          const media = await downloadMediaFromMeta(mediaId!);
          if (!media) {
            console.error("[msg] processing-error", { id: messageId, type: message.type, step: "media-download", error: "downloadMediaFromMeta returned null" });
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
          } else if (message.type === "image" || message.type === "sticker") {
            basePayload.imageBase64 = media.base64;
            const imgObj = (message as Record<string, unknown>).image ?? (message as Record<string, unknown>).sticker ?? {};
            (message as Record<string, unknown>).image = { ...(imgObj as object), base64: media.base64 };
          } else {
            basePayload.videoBase64 = media.base64;
            if (media.mimeType) basePayload.videoMimeType = media.mimeType;
            (message as Record<string, unknown>).video = { ...(message.video || {}), base64: media.base64 };
          }
          console.log("[msg] after-media-download", { id: messageId, ok: true, mimeType: media.mimeType, size: media.base64.length });
        }

        if (!tenant?.webhookUrl || !tenant.internalSecret) {
          if (isImageType) console.log("[msg] early-exit", { id: messageId, step: "missing-tenant", tenantId: resolveResult.tenantId, hasWebhook: !!tenant?.webhookUrl });
          console.warn("[NotificasHub] Tenant sin webhookUrl o internalSecret, no se puede reenviar:", resolveResult.tenantId, "webhookUrl:", !!tenant?.webhookUrl);
        }
        if (tenant?.webhookUrl && tenant.internalSecret) {
          if (isImageType) {
            console.log("[msg] before-tenant-post", { id: messageId, tenantId: resolveResult.tenantId, type: message.type });
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
              console.error("[msg] processing-error", { id: messageId, type: message.type, step: "tenant-post", error: `${res.status} ${text.slice(0, 100)}`, tenantId: resolveResult.tenantId });
              result.errors.push(`tenant ${resolveResult.tenantId}: ${res.status} ${text}`);
            } else {
              if (isImageType) console.log("[msg] tenant-post-ok", { id: messageId, tenantId: resolveResult.tenantId });
              forwarded = true;
            }
          } catch (err) {
            console.error("[msg] processing-error", { id: messageId, type: message.type, step: "tenant-post", error: err instanceof Error ? err.message : String(err), tenantId: resolveResult.tenantId });
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
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[msg] processing-error", { id: messageId, type: message?.type, step: "catch", error: errMsg });
      result.errors.push(`message ${messageId}: ${errMsg}`);
    }
  }

  return result;
}
