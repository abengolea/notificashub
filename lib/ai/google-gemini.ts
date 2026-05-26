import { GoogleGenerativeAI } from "@google/generative-ai";

const DEFAULT_GEMINI = "gemini-2.5-flash";

/** Modelos 2.0 Flash ya no se ofrecen a cuentas nuevas en la API de AI Studio. */
function remapDeprecatedGemini(id: string, envVarName: string): string {
  const n = id.toLowerCase();
  if (
    n === "gemini-2.0-flash" ||
    n.startsWith("gemini-2.0-flash-") ||
    n === "gemini-2.0-flash-exp"
  ) {
    console.warn(
      `[google-gemini] ${envVarName}: "${id}" no está disponible para cuentas nuevas; se usa "${DEFAULT_GEMINI}".`
    );
    return DEFAULT_GEMINI;
  }
  return id;
}

/** Nombres tipo OpenAI (gpt-4o, etc.) no existen en la API de Google → 404. */
function isNonGeminiModelId(id: string): boolean {
  const s = id.trim().toLowerCase();
  if (!s) return true;
  if (s.startsWith("gemini-") || s.startsWith("models/gemini-")) return false;
  return (
    s.startsWith("gpt-") ||
    s.startsWith("o1") ||
    s.startsWith("o2") ||
    s.startsWith("o3") ||
    s.startsWith("chatgpt") ||
    s.startsWith("text-davinci") ||
    s.startsWith("claude-") ||
    s.startsWith("ft:")
  );
}

function normalizeGeminiModelId(id: string): string {
  const t = id.trim();
  if (t.startsWith("models/")) return t.slice("models/".length);
  return t;
}

function resolveGeminiModelId(
  envValue: string | undefined,
  envVarName: string,
  fallback: string
): string {
  const raw = envValue?.trim();
  if (!raw) return fallback;
  if (isNonGeminiModelId(raw)) {
    console.warn(
      `[google-gemini] ${envVarName}="${raw}" no es un modelo Gemini; se usa "${fallback}". ` +
        "Usá un id tipo gemini-2.5-flash o gemini-1.5-pro."
    );
    return fallback;
  }
  return remapDeprecatedGemini(normalizeGeminiModelId(raw), envVarName);
}

export function requireGoogleAiApiKey(): string {
  const key = process.env.GOOGLE_AI_API_KEY?.trim();
  if (!key) {
    throw new Error("Falta GOOGLE_AI_API_KEY en el entorno del servidor.");
  }
  return key;
}

export function accountingPdfModel(): string {
  return resolveGeminiModelId(
    process.env.ACCOUNTING_PDF_AI_MODEL,
    "ACCOUNTING_PDF_AI_MODEL",
    DEFAULT_GEMINI
  );
}

export function billingVerifyModel(): string {
  return resolveGeminiModelId(
    process.env.BILLING_VERIFY_AI_MODEL,
    "BILLING_VERIFY_AI_MODEL",
    DEFAULT_GEMINI
  );
}
export function getGenerativeModel(modelId: string) {
  const genAI = new GoogleGenerativeAI(requireGoogleAiApiKey());
  return genAI.getGenerativeModel({ model: modelId });
}

/** Quita prefijo data:application/pdf;base64, si viene de un data URL. */
export function pdfBase64Payload(raw: string): string {
  const s = raw.trim();
  const m = /^data:application\/pdf;base64,(.+)$/i.exec(s);
  return (m ? m[1] : s).replace(/\s/g, "");
}

/** Parsea JSON del modelo; tolera bloque ```json ... ```. */
export function parseModelJsonObject(text: string): Record<string, unknown> {
  let t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/im.exec(t);
  if (fence) t = fence[1].trim();
  return JSON.parse(t) as Record<string, unknown>;
}
