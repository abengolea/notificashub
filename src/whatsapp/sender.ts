/**
 * Envío de mensajes vía WhatsApp Cloud API (Graph API)
 */
import type { TenantOption } from "./types";

const GRAPH_API = "https://graph.facebook.com/v21.0";

function getConfig(): { phoneNumberId: string; accessToken: string } {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    throw new Error("WHATSAPP_PHONE_NUMBER_ID y WHATSAPP_ACCESS_TOKEN son requeridos");
  }
  return { phoneNumberId, accessToken };
}

export async function sendText(phone: string, text: string): Promise<void> {
  const { phoneNumberId, accessToken } = getConfig();
  const url = `${GRAPH_API}/${phoneNumberId}/messages`;

  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: phone.replace(/\D/g, ""),
    type: "text",
    text: { body: text, preview_url: false },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const textErr = await res.text();
    throw new Error(`WhatsApp API error ${res.status}: ${textErr}`);
  }
}

/**
 * Envía lista interactiva (hasta 10 opciones). Para 2 opciones usa botones.
 */
export async function sendInteractiveList(
  phone: string,
  header: string,
  body: string,
  options: TenantOption[]
): Promise<void> {
  const { phoneNumberId, accessToken } = getConfig();
  const url = `${GRAPH_API}/${phoneNumberId}/messages`;

  if (options.length <= 2) {
    // Botones: max 3
    const buttons = options.slice(0, 3).map((o) => ({
      type: "reply",
      reply: {
        id: String(o.index),
        title: o.label.slice(0, 20), // max 20 chars
      },
    }));

    const msgBody = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone.replace(/\D/g, ""),
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: body },
        action: { buttons },
      },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(msgBody),
    });

    if (!res.ok) {
      const textErr = await res.text();
      throw new Error(`WhatsApp API error ${res.status}: ${textErr}`);
    }
    return;
  }

  // Lista: max 10 opciones
  const rows = options.slice(0, 10).map((o) => ({
    id: String(o.index),
    title: o.label.slice(0, 24),
    description: o.tenantId.slice(0, 72),
  }));

  const msgBody = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: phone.replace(/\D/g, ""),
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: header.slice(0, 60) },
      body: { text: body.slice(0, 1024) },
      action: {
        button: "Elegir servicio",
        sections: [{ title: "Servicios", rows }],
      },
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(msgBody),
  });

  if (!res.ok) {
    const textErr = await res.text();
    throw new Error(`WhatsApp API error ${res.status}: ${textErr}`);
  }
}
