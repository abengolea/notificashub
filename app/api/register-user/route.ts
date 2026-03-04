/**
 * API genérica de registro en NotificasHub.
 * Cualquier app (HeartLink, Náutica, etc.) llama con su internalSecret para
 * agregar/remover usuarios en user_memberships.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase-admin";
import { getTenantInfo } from "@/src/whatsapp/tenants";
import { sanitizePhone } from "@/src/whatsapp/firestore";

const HEADER_TOKEN = "x-internal-token";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function unauthorized() {
  return NextResponse.json({ error: "Invalid or missing x-internal-token" }, { status: 401 });
}

/** Valida que el token coincida con el internalSecret del tenant */
async function validateToken(tenantId: string, token: string): Promise<boolean> {
  const tenant = await getTenantInfo(db, tenantId);
  if (!tenant?.internalSecret) return false;
  return token === tenant.internalSecret;
}

/**
 * POST /api/register-user
 * Body: { phone: string, tenantId: string }
 * Header: x-internal-token (internalSecret del tenant)
 * Upsert en user_memberships, agrega tenantId al array si no existe.
 */
export async function POST(req: NextRequest) {
  const token = req.headers.get(HEADER_TOKEN);
  if (!token) return unauthorized();

  let body: { phone?: string; tenantId?: string };
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const { phone, tenantId } = body;
  if (!phone || typeof phone !== "string" || !tenantId || typeof tenantId !== "string") {
    return badRequest("phone and tenantId are required");
  }

  const valid = await validateToken(tenantId, token);
  if (!valid) return unauthorized();

  const key = sanitizePhone(phone);

  const ref = db.collection("user_memberships").doc(key);
  const snap = await ref.get();

  const now = new Date();

  if (snap.exists) {
    const data = snap.data() as { tenantIds?: string[] };
    const tenantIds = data?.tenantIds ?? [];
    if (tenantIds.includes(tenantId)) {
      return NextResponse.json({
        ok: true,
        message: "Already registered",
        phone,
        tenantIds,
      });
    }
    const updated = [...tenantIds, tenantId];
    await ref.update({ tenantIds: updated, updatedAt: now });
    return NextResponse.json({ ok: true, phone, tenantIds: updated });
  }

  await ref.set({
    phone,
    tenantIds: [tenantId],
    updatedAt: now,
  });

  return NextResponse.json({ ok: true, phone, tenantIds: [tenantId] });
}

/**
 * DELETE /api/register-user
 * Body: { phone: string, tenantId: string }
 * Header: x-internal-token
 * Remueve tenantId del array; si queda vacío, borra el doc.
 */
export async function DELETE(req: NextRequest) {
  const token = req.headers.get(HEADER_TOKEN);
  if (!token) return unauthorized();

  let body: { phone?: string; tenantId?: string };
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const { phone, tenantId } = body;
  if (!phone || typeof phone !== "string" || !tenantId || typeof tenantId !== "string") {
    return badRequest("phone and tenantId are required");
  }

  const valid = await validateToken(tenantId, token);
  if (!valid) return unauthorized();

  const key = sanitizePhone(phone);
  const ref = db.collection("user_memberships").doc(key);
  const snap = await ref.get();

  if (!snap.exists) {
    return NextResponse.json({ ok: true, message: "Not registered", phone, tenantIds: [] });
  }

  const data = snap.data() as { tenantIds?: string[] };
  const tenantIds = (data?.tenantIds ?? []).filter((id) => id !== tenantId);

  if (tenantIds.length === 0) {
    await ref.delete();
    return NextResponse.json({ ok: true, phone, tenantIds: [], deleted: true });
  }

  await ref.update({ tenantIds, updatedAt: new Date() });
  return NextResponse.json({ ok: true, phone, tenantIds });
}
