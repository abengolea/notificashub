import { NextResponse } from "next/server";
import { lastWebhook } from "@/lib/webhook-debug";

export async function GET() {
  return NextResponse.json(lastWebhook ?? { msg: "Ningún webhook recibido aún" });
}
