import { NextResponse } from "next/server";
import { lastWebhook, lastMessageWebhook } from "@/lib/webhook-debug";

export async function GET() {
  return NextResponse.json({
    ultimo: lastWebhook ?? { msg: "Ningún webhook recibido aún" },
    ultimoConMensaje: lastMessageWebhook ?? { msg: "Nunca se recibió un webhook con mensaje entrante" },
  });
}
