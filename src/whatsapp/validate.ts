/**
 * Validación Zod y parsers para payloads de WhatsApp Cloud API
 */
import { z } from "zod";
import type { IncomingMessage } from "./types";

// --- Schemas Zod ---
const metaReferralSchema = z.object({
  type: z.string().optional(),
  ref: z.string().optional(),
  source_url: z.string().optional(),
});

const metaTextSchema = z.object({
  body: z.string().optional(),
});

const metaInteractiveReplySchema = z.object({
  type: z.enum(["list_reply", "button_reply"]),
  list_reply: z
    .object({
      id: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
    })
    .optional(),
  button_reply: z
    .object({
      id: z.string(),
      title: z.string().optional(),
    })
    .optional(),
});

// Objetos de media de Meta: video, image, audio, document (HeartLink necesita message.video.id, etc.)
const metaMediaSchema = z
  .object({
    id: z.string(),
    mime_type: z.string().optional(),
    sha256: z.string().optional(),
  })
  .passthrough();

const metaMessageSchema = z
  .object({
    id: z.string(),
    from: z.string(),
    timestamp: z.string(),
    type: z.enum(["text", "interactive", "image", "audio", "video", "document", "button", "contacts"]),
    text: metaTextSchema.optional(),
    interactive: metaInteractiveReplySchema.optional(),
    referral: metaReferralSchema.optional(),
    video: metaMediaSchema.optional(),
    image: metaMediaSchema.optional(),
    audio: metaMediaSchema.optional(),
    document: metaMediaSchema.optional(),
    contacts: z.array(z.unknown()).optional(),
  })
  .passthrough();

const metaValueSchema = z.object({
  messages: z.array(metaMessageSchema).optional(),
  contacts: z
    .array(
      z.object({
        wa_id: z.string().optional(),
        profile: z.object({ name: z.string().optional() }).optional(),
      })
    )
    .optional(),
  statuses: z.array(z.unknown()).optional(),
});

const metaChangeSchema = z.object({
  value: metaValueSchema.optional(),
});

const metaEntrySchema = z.object({
  changes: z.array(metaChangeSchema).optional(),
});

export const webhookBodySchema = z.object({
  entry: z.array(metaEntrySchema).optional(),
});

export type WebhookBody = z.infer<typeof webhookBodySchema>;

/**
 * Extrae mensajes entrantes del payload del webhook de Meta.
 * Soporta estructura variada (entry[].changes[].value.messages)
 */
export function extractIncomingMessages(body: unknown): Array<{
  message: z.infer<typeof metaMessageSchema>;
  from: string;
  contactName?: string;
  value: z.infer<typeof metaValueSchema>;
}> {
  const parsed = webhookBodySchema.safeParse(body);
  if (!parsed.success) return [];

  const entries = parsed.data.entry ?? [];
  const result: Array<{
    message: z.infer<typeof metaMessageSchema>;
    from: string;
    contactName?: string;
    value: z.infer<typeof metaValueSchema>;
  }> = [];

  for (const entry of entries) {
    const changes = entry.changes ?? [];
    for (const change of changes) {
      const value = change.value;
      if (!value?.messages?.length) continue;

      for (const message of value.messages) {
        const msgParsed = metaMessageSchema.safeParse(message);
        if (!msgParsed.success) continue;

        const from = message.from ?? value.contacts?.[0]?.wa_id ?? "";
        const contactName = value.contacts?.[0]?.profile?.name;

        result.push({
          message: msgParsed.data,
          from,
          contactName,
          value,
        });
      }
    }
  }

  // Fallback: estructura clásica body.entry[0].changes[0].value
  if (result.length === 0 && body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    const entry0 = Array.isArray(obj.entry) ? obj.entry[0] : undefined;
    const changes = entry0 && typeof entry0 === "object" && "changes" in entry0
      ? (entry0 as { changes?: unknown[] }).changes
      : undefined;
    const change0 = Array.isArray(changes) ? changes[0] : undefined;
    const value = change0 && typeof change0 === "object" && "value" in change0
      ? (change0 as { value: unknown }).value
      : undefined;

    if (value && typeof value === "object") {
      const v = value as { messages?: unknown[]; contacts?: { wa_id?: string; profile?: { name?: string } }[] };
      const messages = v.messages ?? [];
      for (const msg of messages) {
        const msgParsed = metaMessageSchema.safeParse(msg);
        if (msgParsed.success) {
          const from = msgParsed.data.from ?? v.contacts?.[0]?.wa_id ?? "";
          result.push({
            message: msgParsed.data,
            from,
            contactName: v.contacts?.[0]?.profile?.name,
            value: v as z.infer<typeof metaValueSchema>,
          });
        }
      }
    }
  }

  return result;
}

/**
 * Parsea respuesta numérica del usuario (1, 2, 3) para elegir tenant.
 * Soporta texto "1", "2", "3" e interactive list/button reply con id "1", "2", "3".
 */
export function parseNumericChoice(message: {
  type?: string;
  text?: { body?: string };
  interactive?: {
    type?: string;
    list_reply?: { id?: string };
    button_reply?: { id?: string };
  };
}): number | null {
  if (message.type === "interactive" && message.interactive) {
    const id = parseInteractiveChoiceId(message);
    if (id) {
      const n = parseInt(id, 10);
      return Number.isInteger(n) && n >= 1 && n <= 9 ? n : null;
    }
  }

  if (message.type === "text" && message.text?.body) {
    const trimmed = message.text.body.trim();
    const n = parseInt(trimmed, 10);
    return Number.isInteger(n) && n >= 1 && n <= 9 ? n : null;
  }

  return null;
}

/**
 * Extrae ID de interactive.button_reply o list_reply.
 * Permite resolver elección por "1"/"2"/"3" (índice) o por tenantId ("heartlink", "river").
 */
export function parseInteractiveChoiceId(message: {
  type?: string;
  interactive?: {
    list_reply?: { id?: string };
    button_reply?: { id?: string };
  };
}): string | null {
  if (message.type === "interactive" && message.interactive) {
    const id =
      message.interactive.list_reply?.id ??
      message.interactive.button_reply?.id;
    return id?.trim() ?? null;
  }
  return null;
}

/**
 * Extrae token de referral o texto prefijado (ej. wa.me?text=RIVER).
 * referral.ref o text.body si es token conocido (ej. RIVER, NAUTICA, HEARTLINK).
 */
export function parseReferralToken(message: {
  type?: string;
  text?: { body?: string };
  referral?: { ref?: string; source_url?: string };
}): string | null {
  if (message.referral?.ref) {
    return message.referral.ref.toUpperCase().trim();
  }

  if (message.type === "text" && message.text?.body) {
    const body = message.text.body.trim().toUpperCase();
    // Tomar primera palabra como token (ej. "RIVER hola" -> RIVER)
    const firstWord = body.split(/\s+/)[0];
    if (firstWord && /^[A-Z0-9_]+$/.test(firstWord)) {
      return firstWord;
    }
  }

  return null;
}

/**
 * Convierte mensaje Meta a IncomingMessage normalizado
 */
export function toIncomingMessage(
  message: z.infer<typeof metaMessageSchema>,
  from: string
): IncomingMessage {
  const textBody = message.text?.body;
  const referralToken = parseReferralToken(message);
  const numericChoice = parseNumericChoice(message);
  const interactiveChoiceId = parseInteractiveChoiceId(message);

  return {
    id: message.id,
    from,
    timestamp: message.timestamp,
    type: message.type,
    textBody,
    referralToken: referralToken ?? undefined,
    numericChoice: numericChoice ?? undefined,
    interactiveChoiceId: interactiveChoiceId ?? undefined,
  };
}
