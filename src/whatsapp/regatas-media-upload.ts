import { getStorage } from "firebase-admin/storage";
import { adminApp } from "@/lib/firebase-admin";

const SIGNED_URL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Sube bytes a Storage y devuelve URL firmada (lectura) para que Regatas+ descargue la imagen.
 * Si no hay env, intenta el bucket por defecto `{projectId}.appspot.com` (mismo proyecto que Firestore).
 */
const DEFAULT_PROJECT = "studio-3864746689-59018";

export async function uploadInboundMediaSignedUrl(params: {
  base64: string;
  mimeType: string;
  messageId: string;
}): Promise<string | null> {
  const bucketName =
    process.env.FIREBASE_STORAGE_BUCKET?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() ||
    `${DEFAULT_PROJECT}.appspot.com`;

  try {
    const bucket = getStorage(adminApp).bucket(bucketName);
    const sub = params.mimeType.split("/")[1]?.split(";")[0]?.replace(/[^a-z0-9]/gi, "") || "bin";
    const path = `wa-router-regatas/${params.messageId}.${sub}`;
    const buffer = Buffer.from(params.base64, "base64");
    const file = bucket.file(path);
    await file.save(buffer, {
      metadata: { contentType: params.mimeType.split(";")[0]?.trim() || "application/octet-stream" },
    });
    const [url] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + SIGNED_URL_TTL_MS,
    });
    return url;
  } catch (e) {
    console.error("[NotificasHub] uploadInboundMediaSignedUrl:", e);
    return null;
  }
}
