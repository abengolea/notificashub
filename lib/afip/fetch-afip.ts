import { Agent, fetch as undiciFetch, type RequestInit, type Response } from "undici";
import { envTrimmedKey } from "@/lib/env-trim-key";

let cachedAgent: Agent | undefined;
let cachedLevel: string | undefined;

/**
 * Servidores AFIP pueden ofrecer parámetros DH que OpenSSL 3 (Node/undici) rechaza con
 * ERR_SSL_DH_KEY_TOO_SMALL. Bajar SECLEVEL mantiene verificación del cert del servidor.
 *
 * AFIP_TLS_SECLEVEL: "1" (default) o "0" si aún falla (solo legacy; menos restrictivo).
 */
export function getAfipTlsAgent(): Agent {
  const levelRaw = envTrimmedKey("AFIP_TLS_SECLEVEL");
  const level = levelRaw && /^[0-2]$/.test(levelRaw) ? levelRaw : "1";
  if (cachedAgent && cachedLevel === level) {
    return cachedAgent;
  }
  cachedLevel = level;
  cachedAgent = new Agent({
    connect: {
      ciphers: `DEFAULT@SECLEVEL=${level}`,
    },
  });
  return cachedAgent;
}

/** Cierra conexiones del pool TLS (evita crash libuv en Windows al salir con undici). */
export async function closeAfipTlsAgent(): Promise<void> {
  if (!cachedAgent) return;
  const a = cachedAgent;
  cachedAgent = undefined;
  cachedLevel = undefined;
  await a.close();
}

/** fetch hacia AFIP con TLS compatible (mismo stack en WSAA/WSFE). */
export function afipFetch(url: string, init: RequestInit): Promise<Response> {
  return undiciFetch(url, {
    ...init,
    dispatcher: getAfipTlsAgent(),
  });
}
