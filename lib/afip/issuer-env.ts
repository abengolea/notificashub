import { BILLING_EMISOR } from "@/lib/billing/constants";
import { envTrimmedKey } from "@/lib/env-trim-key";

/**
 * Metadatos de emisor para PDF / pantalla.
 * En **Notificas Hub** el emisor electrónico es siempre **Notificas SRL** (`BILLING_EMISOR`): la misma
 * sociedad que debe figurar en el certificado AFIP (`AFIP_CUIT`). Las variables `AFIP_*` opcionales
 * solo sirven si querés sobreescribir textos (domicilio en factura impresa, etc.).
 */
export function getAfipIssuerDisplayFromEnv(): {
  razonSocial: string;
  domicilio: string;
  telefono: string;
  email: string;
  ingresosBrutos: string;
  inicioActividades: string;
} {
  const cuitDigits = BILLING_EMISOR.cuit.replace(/\D/g, "");
  return {
    razonSocial: envTrimmedKey("AFIP_RAZON_SOCIAL") || BILLING_EMISOR.razonSocial,
    domicilio: envTrimmedKey("AFIP_DOMICILIO") || BILLING_EMISOR.domicilio,
    telefono: envTrimmedKey("AFIP_TELEFONO") || "",
    email: envTrimmedKey("AFIP_EMAIL") || "",
    ingresosBrutos: envTrimmedKey("AFIP_ING_BRUTOS") || cuitDigits,
    inicioActividades: envTrimmedKey("AFIP_INICIO_ACTIVIDADES") || "",
  };
}

/** `AFIP_CBTE_TIPO` en .env (1=A, 6=B, 11=C). Si no es válido, devuelve undefined. */
export function getAfipCbteTipoFromEnv(): number | undefined {
  const raw = envTrimmedKey("AFIP_CBTE_TIPO");
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const n = parseInt(raw, 10);
  if (n === 1 || n === 6 || n === 11) return n;
  return undefined;
}

/** Punto de venta por defecto desde env (mismo valor que uses en ARCA para Notificas SRL). */
export function getAfipPtoVtaDefaultFromEnv(): number {
  const raw = envTrimmedKey("AFIP_PTO_VTA");
  if (!raw || !/^\d+$/.test(raw)) return 0;
  const n = parseInt(raw, 10);
  if (n < 1 || n > 99999) return 0;
  return n;
}
