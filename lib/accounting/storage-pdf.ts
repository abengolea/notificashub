import { randomBytes } from "node:crypto";
import { getStorage } from "firebase-admin/storage";
import { adminApp } from "@/lib/firebase-admin";

const PROJECT_ID = "studio-3864746689-59018";

export async function uploadAccountingPdf(params: {
  buffer: Buffer;
  originalName: string;
}): Promise<{ storagePath: string }> {
  const bucketName =
    process.env.FIREBASE_STORAGE_BUCKET?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() ||
    `${PROJECT_ID}.appspot.com`;

  const safeName = params.originalName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  const suffix = randomBytes(8).toString("hex");
  const storagePath = `accounting-notificas-srl/pdf-inbox/${Date.now()}_${suffix}_${safeName || "documento.pdf"}`;

  const bucket = getStorage(adminApp).bucket(bucketName);
  const file = bucket.file(storagePath);
  await file.save(params.buffer, {
    metadata: { contentType: "application/pdf" },
  });

  return { storagePath };
}
