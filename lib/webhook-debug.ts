// Debug: último webhook recibido (solo estructura)
export let lastWebhook: {
  at: string;
  hasMessage: boolean;
  hasStatuses: boolean;
  from?: string;
  messageType?: string;
  bodyKeys?: string[];
  valueKeys?: string[];
} | null = null;

export function setLastWebhook(info: typeof lastWebhook) {
  lastWebhook = info;
}
