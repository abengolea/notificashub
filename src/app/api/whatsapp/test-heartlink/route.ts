import { NextResponse } from "next/server";

/**
 * GET /api/whatsapp/test-heartlink
 * Diagnóstico: prueba la conexión NotificasHub → HeartLink
 */
export async function GET() {
  const url = process.env.HEARTLINK_URL;
  const secret = process.env.INTERNAL_SECRET;

  if (!url || !secret) {
    return NextResponse.json({
      ok: false,
      error: "Faltan HEARTLINK_URL o INTERNAL_SECRET",
      HEARTLINK_URL: url ? "✓" : "✗",
      INTERNAL_SECRET: secret ? "✓" : "✗",
    });
  }

  const testPayload = {
    from: "5493364645357",
    message: { type: "text", text: { body: "hola" }, id: "test-debug", timestamp: "1234567890" },
    contactName: "Test",
    messageId: "test-debug",
    timestamp: "1234567890",
  };

  try {
    const res = await fetch(`${url}/api/whatsapp/incoming`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-token": secret,
      },
      body: JSON.stringify(testPayload),
    });

    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }

    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      heartlinkResponse: body,
      config: { url, secretPresent: !!secret },
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: String(err),
      config: { url, secretPresent: !!secret },
    });
  }
}
