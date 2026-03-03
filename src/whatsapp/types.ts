/**
 * Tipos para WhatsApp Router multi-tenant (NotificasHub)
 */

// --- Webhook Meta (entrada) ---
export interface MetaReferral {
  type: string;
  ref?: string;
  source_url?: string;
}

export interface MetaTextMessage {
  body?: string;
}

export interface MetaInteractiveReply {
  type: "list_reply" | "button_reply";
  list_reply?: { id: string; title: string; description?: string };
  button_reply?: { id: string; title: string };
}

export interface MetaMessage {
  id: string;
  from: string;
  timestamp: string;
  type: "text" | "interactive" | "image" | "audio" | "video" | "document" | "button";
  text?: MetaTextMessage;
  interactive?: MetaInteractiveReply;
  referral?: MetaReferral;
}

export interface MetaContact {
  wa_id?: string;
  profile?: { name?: string };
}

// --- Resolución de tenant ---
export type ResolveAction =
  | { action: "silent_unregistered" }
  | { action: "silent_or_handoff" }
  | { action: "route"; tenantId: string }
  | { action: "ask_choice"; options: TenantOption[] };

export interface TenantOption {
  index: number;
  tenantId: string;
  label: string;
}

// --- Firestore documents ---
export interface TenantDoc {
  name: string;
  status: string;
  referralTokens?: string[];
  webhookUrl?: string;
  internalSecret?: string;
}

export interface UserMembershipDoc {
  phone: string;
  tenantIds: string[];
  updatedAt: FirebaseTimestamp;
}

export interface WaSessionDoc {
  phone: string;
  conversationId?: string;
  activeTenantId: string;
  state: string;
  createdAt: FirebaseTimestamp;
  updatedAt: FirebaseTimestamp;
  expiresAt: FirebaseTimestamp;
}

export interface WaMessageDoc {
  direction: "in" | "out";
  phone: string;
  tenantId?: string;
  payload: Record<string, unknown>;
  createdAt: FirebaseTimestamp;
  pricingCategory?: string;
}

export interface WaPendingChoiceDoc {
  options: TenantOption[];
  createdAt: FirebaseTimestamp;
  expiresAt: FirebaseTimestamp;
  attempts: number;
}

export interface WaLastTenantDoc {
  tenantId: string;
  updatedAt: FirebaseTimestamp;
}

type FirebaseTimestamp = { _seconds?: number } | { seconds: number } | Date;

// --- Mensaje normalizado para procesamiento ---
export interface IncomingMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  textBody?: string;
  referralToken?: string;
  /** Índice numérico 1-9 (texto o interactive) */
  numericChoice?: number;
  /** ID raw de interactive.button_reply.id / list_reply.id (permite "1" o tenantId) */
  interactiveChoiceId?: string;
}
