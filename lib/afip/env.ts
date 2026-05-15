import { readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { envTrimmedKey, normalizeAfipSdkAccessToken } from "@/lib/env-trim-key";
import { getAfipPtoVtaDefaultFromEnv } from "@/lib/afip/issuer-env";

const AFIP_SDK_TOKEN_KEYS = ["AFIP_ACCESS_TOKEN", "AFIPSDK_ACCESS_TOKEN", "AFIPS_ACCESS_TOKEN"] as const;

/** Resuelve token del relay Afip SDK y nombre de variable usada. */
export function resolveAfipSdkAccessTokenFromEnv(): { token?: string; envKey?: string } {
  for (const k of AFIP_SDK_TOKEN_KEYS) {
    const raw = envTrimmedKey(k);
    if (raw) {
      return { token: normalizeAfipSdkAccessToken(raw), envKey: k };
    }
  }
  return {};
}

/** Rutas de servicio WSAA / WSFE según entorno AFIP. */
export const AFIP_ENDPOINTS = {
  wsaa: {
    prod: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
    homo: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
  },
  wsfe: {
    prod: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
    homo: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  },
} as const;

export type AfipIntegrationEnv = {
  cuit: string;
  cuitNumeric: number;
  production: boolean;
  ptoVtaDefault: number;
  certPath: string;
  keyPath: string;
  chainPath: string | undefined;
  workDir: string;
  accessToken: string | undefined;
  accessTokenEnvKey: string | undefined;
  certPem: string;
  keyPem: string;
  opensslPath: string | undefined;
  warnings: string[];
};

function normalizePathSlashes(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

function looksHomoPath(p: string): boolean {
  const n = normalizePathSlashes(p);
  return n.includes("/homo/") || n.includes("/homologacion/") || n.includes("homo.");
}

function looksProdPath(p: string): boolean {
  const n = normalizePathSlashes(p);
  return n.includes("/prod/") || n.includes("/produccion/") || n.includes("/production/");
}

function buildCertPem(certResolved: string, chainResolved: string | undefined): string {
  const certPemRaw = readFileSync(certResolved, "utf8");
  let certPem = certPemRaw.trimEnd();
  if (chainResolved && existsSync(chainResolved)) {
    const chainPem = readFileSync(chainResolved, "utf8").trim();
    certPem = `${certPem}\n${chainPem}`;
  }
  return certPem;
}

/**
 * Configuración central AFIP (.env + archivos).
 * No loguea secretos.
 */
export function loadAfipIntegrationEnv(): AfipIntegrationEnv | { error: string } {
  const cuit = (envTrimmedKey("AFIP_CUIT") ?? "").replace(/\D/g, "");
  if (cuit.length < 11) {
    return { error: "Falta AFIP_CUIT válido (11 dígitos) en el servidor" };
  }

  const prodRaw = (envTrimmedKey("AFIP_PRODUCTION") ?? "").toLowerCase();
  const production = prodRaw === "1" || prodRaw === "true";

  const certPathRaw = envTrimmedKey("AFIP_CERT_PATH");
  const keyPathRaw = envTrimmedKey("AFIP_KEY_PATH");
  if (!certPathRaw || !keyPathRaw) {
    return {
      error:
        "Definí AFIP_CERT_PATH y AFIP_KEY_PATH apuntando a tus archivos .crt y .key (fuera del repo).",
    };
  }

  const certResolved = path.resolve(certPathRaw);
  const keyResolved = path.resolve(keyPathRaw);
  if (!existsSync(certResolved) || !existsSync(keyResolved)) {
    return {
      error: `No se encontró certificado o clave: cert=${certResolved} | key=${keyResolved}`,
    };
  }

  const chainRaw = envTrimmedKey("AFIP_CHAIN_PATH");
  const chainResolved = chainRaw ? path.resolve(chainRaw) : undefined;
  if (chainResolved && !existsSync(chainResolved)) {
    return { error: `AFIP_CHAIN_PATH no existe: ${chainResolved}` };
  }

  const warnings: string[] = [];

  if (production) {
    if (looksHomoPath(certResolved) || looksHomoPath(keyResolved)) {
      warnings.push(
        "⚠ AFIP_PRODUCTION=true pero las rutas de certificado/clave parecen de homologación (/homo/, etc.). Revisá que uses certificados de producción.",
      );
    }
  } else {
    if (looksProdPath(certResolved) || looksProdPath(keyResolved)) {
      warnings.push(
        "⚠ AFIP_PRODUCTION=false pero las rutas parecen de producción (/prod/, etc.). Revisá el entorno y los certificados.",
      );
    }
  }

  const workDirRaw = envTrimmedKey("AFIP_WORK_DIR");
  const workDir = workDirRaw ? path.resolve(workDirRaw) : path.resolve(process.cwd(), ".afip-cache");
  try {
    mkdirSync(workDir, { recursive: true });
  } catch {
    return { error: `No se pudo crear/usar AFIP_WORK_DIR: ${workDir}` };
  }

  const opensslPath = envTrimmedKey("OPENSSL_PATH");

  const certPem = buildCertPem(certResolved, chainResolved);
  const keyPem = readFileSync(keyResolved, "utf8");
  const { token: accessToken, envKey: accessTokenEnvKey } = resolveAfipSdkAccessTokenFromEnv();
  const ptoVtaDefault = getAfipPtoVtaDefaultFromEnv();

  return {
    cuit,
    cuitNumeric: parseInt(cuit, 10),
    production,
    ptoVtaDefault,
    certPath: certResolved,
    keyPath: keyResolved,
    chainPath: chainResolved,
    workDir,
    accessToken,
    accessTokenEnvKey,
    certPem,
    keyPem,
    opensslPath,
    warnings,
  };
}

export function afipWsaaUrl(production: boolean): string {
  return production ? AFIP_ENDPOINTS.wsaa.prod : AFIP_ENDPOINTS.wsaa.homo;
}

export function afipWsfeUrl(production: boolean): string {
  return production ? AFIP_ENDPOINTS.wsfe.prod : AFIP_ENDPOINTS.wsfe.homo;
}
