import { normalizeHubPhone } from "./phone-normalize";
import { uploadInboundMediaSignedUrl } from "./regatas-media-upload";

/** Extrae texto legible desde el mensaje Meta (contrato Regatas+ solo admite text | image). */
export function extractRegatasTextFromMetaMessage(message: Record<string, unknown>): string {
  const type = message.type as string;
  if (type === "text" && message.text && typeof message.text === "object") {
    const body = (message.text as { body?: string }).body;
    if (body?.trim()) return body.trim();
  }
  if (type === "interactive" && message.interactive && typeof message.interactive === "object") {
    const ir = message.interactive as {
      list_reply?: { title?: string; description?: string };
      button_reply?: { title?: string };
    };
    if (ir.list_reply?.title) {
      const parts = [ir.list_reply.title, ir.list_reply.description].filter(Boolean);
      return parts.join(" — ");
    }
    if (ir.button_reply?.title) return ir.button_reply.title;
  }
  if (type === "contacts") return "[Contacto compartido]";
  if (type === "document") {
    const doc = message.document as { filename?: string; caption?: string } | undefined;
    const bit = doc?.caption || doc?.filename;
    return bit ? `[Documento] ${bit}` : "[Documento]";
  }
  if (type === "video") return "[Video]";
  if (type === "audio") return "[Audio]";
  if (type === "button") {
    const b = message.button as { text?: string } | undefined;
    return b?.text?.trim() || "[Botón]";
  }
  return "";
}

export type RegatasPlusWebhookBody = {
  phone: string;
  tenantId: string;
  waMessageId: string;
  message: { type: "text" | "image"; text?: string; imageUrl?: string };
};

export async function buildRegatasPlusWebhookBody(options: {
  phone: string;
  tenantId: string;
  waMessageId: string;
  message: Record<string, unknown>;
  imageBase64?: string;
  imageMimeType?: string;
}): Promise<RegatasPlusWebhookBody> {
  const phone = normalizeHubPhone(options.phone);
  const type = options.message.type as string;
  const wantsImage =
    (type === "image" || type === "sticker") &&
    typeof options.imageBase64 === "string" &&
    options.imageBase64.length > 0;

  if (wantsImage) {
    const imageUrl = await uploadInboundMediaSignedUrl({
      base64: options.imageBase64!,
      mimeType: options.imageMimeType || "image/jpeg",
      messageId: options.waMessageId,
    });
    if (imageUrl) {
      return {
        phone,
        tenantId: options.tenantId,
        waMessageId: options.waMessageId,
        message: { type: "image", imageUrl },
      };
    }
    const caption = extractRegatasTextFromMetaMessage(options.message);
    return {
      phone,
      tenantId: options.tenantId,
      waMessageId: options.waMessageId,
      message: {
        type: "text",
        text:
          caption ||
          "Recibimos una imagen pero no pudimos generar un enlace público. Configurá FIREBASE_STORAGE_BUCKET en NotificasHub o reintentá.",
      },
    };
  }

  const text = extractRegatasTextFromMetaMessage(options.message);
  return {
    phone,
    tenantId: options.tenantId,
    waMessageId: options.waMessageId,
    message: { type: "text", text: text || "" },
  };
}
