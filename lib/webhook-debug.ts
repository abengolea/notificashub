// Debug: último webhook recibido (solo estructura)
type WebhookInfo = {
  at: string;
  hasMessage: boolean;
  hasStatuses: boolean;
  from?: string;
  messageType?: string;
  bodyKeys?: string[];
  valueKeys?: string[];
};

export let lastWebhook: WebhookInfo | null = null;
// No sobrescribir: guardar el último que SÍ tenía mensaje (para no perderlo cuando lleguen statuses)
export let lastMessageWebhook: WebhookInfo | null = null;

export function setLastWebhook(info: WebhookInfo | null) {
  lastWebhook = info;
  if (info?.hasMessage) {
    lastMessageWebhook = info;
  }
}
