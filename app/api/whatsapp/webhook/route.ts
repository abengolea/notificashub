import { NextRequest, NextResponse } from "next/server";
import { processWhatsAppWebhookPayload } from "@/lib/whatsapp-meta-webhook";

export const runtime = "nodejs";

/**
 * Verificación GET del webhook (Meta: hub.mode, hub.verify_token, hub.challenge).
 */
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");

  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!expected) {
    return new NextResponse("Webhook verify token no configurado", {
      status: 503,
    });
  }

  if (mode === "subscribe" && token === expected && challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

/**
 * POST de Meta (Cloud API). Las escrituras a Firestore se esperan aquí antes de responder,
 * para que en App Hosting / serverless no se corte el trabajo al devolver la respuesta.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  try {
    const result = await processWhatsAppWebhookPayload(body);
    if (result.errors.length > 0) {
      console.error(
        "[whatsapp-webhook] Errores parciales (respuesta 200 para Meta):",
        result.errors
      );
    }
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (e) {
    console.error("[whatsapp-webhook] Error no controlado:", e);
    return NextResponse.json(
      {
        ok: true,
        processed: 0,
        skipped: 0,
        errors: [e instanceof Error ? e.message : String(e)],
      },
      { status: 200 }
    );
  }
}
