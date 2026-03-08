/**
 * Descarga media (document, image, etc.) desde la API de Meta.
 * Usado para enriquecer el payload al reenviar a tenants (Náutica, etc.)
 * que necesitan documentBase64 o mediaUrl.
 *
 * Meta envía message.document.id o message.image.id; hay que:
 * 1. GET graph.facebook.com/v21.0/{id} → obtiene url temporal
 * 2. GET esa url con token → descarga bytes
 * 3. Convierte a base64
 */
const GRAPH_API = "https://graph.facebook.com/v21.0";

function getAccessToken(): string {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) throw new Error("WHATSAPP_ACCESS_TOKEN requerido para descargar media");
  return token;
}

export interface MediaResult {
  base64: string;
  mediaUrl: string;
  mimeType?: string;
  filename?: string;
}

const RETRY_DELAY_MS = 800;
const MAX_ATTEMPTS = 3;

/**
 * Descarga un archivo de media de Meta y devuelve base64 + URL temporal.
 * Si falla, devuelve null.
 */
async function downloadMediaOnce(mediaId: string): Promise<MediaResult | null> {
  const token = getAccessToken();

  // 1. Obtener URL temporal
  const metaRes = await fetch(`${GRAPH_API}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) {
    console.warn("[media-download] Meta API error:", metaRes.status, await metaRes.text());
    return null;
  }
  const metaData = (await metaRes.json()) as { url?: string; mime_type?: string; filename?: string };
  const mediaUrl = metaData.url;
  if (!mediaUrl) {
    console.warn("[media-download] No url in Meta response");
    return null;
  }

  // 2. Descargar bytes
  const blobRes = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!blobRes.ok) {
    console.warn("[media-download] Download error:", blobRes.status);
    return null;
  }
  const buffer = await blobRes.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // 3. Base64
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = Buffer.from(binary, "binary").toString("base64");

  return {
    base64,
    mediaUrl,
    mimeType: metaData.mime_type,
    filename: metaData.filename,
  };
}

/**
 * Descarga media de Meta con reintentos. NauticAdmin necesita base64;
 * mediaUrl sola no sirve (requiere token de Meta).
 */
export async function downloadMediaFromMeta(
  mediaId: string
): Promise<MediaResult | null> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await downloadMediaOnce(mediaId);
      if (result) return result;
    } catch (err) {
      console.warn(`[media-download] Attempt ${attempt}/${MAX_ATTEMPTS} failed:`, err);
    }
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  return null;
}

/**
 * Extrae mediaId de message según type (document, image, etc.)
 */
export function getMediaIdFromMessage(
  message: { type?: string; document?: { id?: string }; image?: { id?: string }; video?: { id?: string }; audio?: { id?: string }; sticker?: { id?: string } }
): string | null {
  if (message.type === "document" && message.document?.id) return message.document.id;
  if (message.type === "image" && message.image?.id) return message.image.id;
  if (message.type === "sticker" && message.sticker?.id) return message.sticker.id;
  if (message.type === "video" && message.video?.id) return message.video.id;
  if (message.type === "audio" && message.audio?.id) return message.audio.id;
  return null;
}
