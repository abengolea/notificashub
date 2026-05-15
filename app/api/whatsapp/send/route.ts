/**
 * POST /api/whatsapp/send
 *
 * Endpoint para que los tenants (Náutica, HeartLink, etc.) envíen mensajes
 * al usuario por WhatsApp. Usa la API de Meta del número de NotificasHub.
 *
 * Body: { to: string, text?: string, template?: { name, language: { code }, components? }, tenantId? }
 * Header: x-internal-token o x-internal-secret (internalSecret del tenant)
 *
 * Valida que el token coincida con el internalSecret del tenant.
 * Si tenantId no se envía, busca un tenant cuyo internalSecret coincida.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase-admin";
import { getTenantInfo } from "@/src/whatsapp/tenants";
import { sendText, sendTemplate, type WhatsAppTemplateBody } from "@/src/whatsapp/sender";

const HEADER_TOKEN = "x-internal-token";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function unauthorized() {
  return NextResponse.json(
    { error: "Invalid or missing x-internal-token / x-internal-secret" },
    { status: 401 }
  );
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length === 10 && !digits.startsWith("54")) {
    return "549" + digits;
  }
  return digits;
}

/** Busca tenant cuyo internalSecret coincida con el token */
async function findTenantByToken(token: string): Promise<string | null> {
  const snap = await db.collection("tenants").get();
  for (const doc of snap.docs) {
    const d = doc.data() as { internalSecret?: string };
    if (d?.internalSecret === token) return doc.id;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const token = req.headers.get(HEADER_TOKEN) ?? req.headers.get("x-internal-secret");
  if (!token?.trim()) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const to = (body.to ?? body.phone ?? body.from) as string | undefined;
  const text = (body.text ?? body.message) as string | undefined;
  const templateRaw = body.template as Record<string, unknown> | undefined;
  const template: WhatsAppTemplateBody | null =
    templateRaw &&
    typeof templateRaw.name === "string" &&
    templateRaw.language &&
    typeof (templateRaw.language as { code?: string }).code === "string"
      ? {
          name: templateRaw.name,
          language: { code: (templateRaw.language as { code: string }).code },
          components: Array.isArray(templateRaw.components) ? templateRaw.components : undefined,
        }
      : null;

  let tenantId =
    ((body.tenantId ?? body.tenant_id) as string | undefined)?.trim() ||
    req.headers.get("x-tenant-id")?.trim() ||
    undefined;

  if (!to || typeof to !== "string") {
    return badRequest("to (or phone/from) is required");
  }
  if (!template && (!text || typeof text !== "string")) {
    return badRequest("text (or message) or template { name, language: { code } } is required");
  }

  if (!tenantId) {
    const found = await findTenantByToken(token);
    if (!found) return unauthorized();
    tenantId = found;
  } else {
    const tenant = await getTenantInfo(db, tenantId);
    if (!tenant?.internalSecret || tenant.internalSecret !== token) {
      return unauthorized();
    }
  }

  try {
    const phone = normalizePhone(to);
    if (template) {
      await sendTemplate(phone, template);
    } else {
      await sendText(phone, text!);
    }
    return NextResponse.json({ ok: true, sent: true });
  } catch (err) {
    console.error("[whatsapp/send]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Error al enviar" },
      { status: 500 }
    );
  }
}
