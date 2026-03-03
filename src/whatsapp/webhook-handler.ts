/**
 * Thin wrapper HTTP: recibe request, delega a process-inbound, devuelve response.
 * Desacoplado de Next.js: solo orquesta y extrae statuses.
 */
import type { Firestore } from "firebase-admin/firestore";
import { processInbound } from "./process-inbound";

export interface WebhookHandlerResult {
  messages: { processed: number; duplicate: number; errors: string[] };
  statusesHandled: boolean;
}

export function extractStatuses(
  body: unknown
): Array<{ id: string; status: string; timestamp: string }> {
  if (!body || typeof body !== "object") return [];
  const obj = body as Record<string, unknown>;
  const entry = Array.isArray(obj.entry) ? obj.entry[0] : undefined;
  if (!entry || typeof entry !== "object") return [];
  const changes = (entry as { changes?: unknown[] }).changes;
  const change = Array.isArray(changes) ? changes[0] : undefined;
  if (!change || typeof change !== "object") return [];
  const value = (change as { value?: { statuses?: unknown[] } }).value;
  const statuses = value?.statuses ?? [];
  return statuses as Array<{ id: string; status: string; timestamp: string }>;
}

export async function handleIncomingWebhook(
  db: Firestore,
  body: unknown
): Promise<WebhookHandlerResult> {
  const messages = await processInbound(db, body);
  const statuses = extractStatuses(body);

  return {
    messages,
    statusesHandled: statuses.length > 0,
  };
}
