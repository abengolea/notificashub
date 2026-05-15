// Paquete CommonJS
import Afip from "@afipsdk/afip.js";
import { loadAfipIntegrationEnv } from "@/lib/afip/env";

export type AfipEnvConfig = {
  cuit: string;
  production: boolean;
  certPem: string;
  keyPem: string;
  accessToken?: string;
  accessTokenEnvKey?: string;
};

export {
  loadAfipIntegrationEnv,
  type AfipIntegrationEnv,
  resolveAfipSdkAccessTokenFromEnv,
  AFIP_ENDPOINTS,
} from "@/lib/afip/env";

/** @deprecated Prefer loadAfipIntegrationEnv; se mantiene para rutas API existentes. */
export function loadAfipConfigFromEnv(): AfipEnvConfig | { error: string } {
  const r = loadAfipIntegrationEnv();
  if ("error" in r) return r;
  return {
    cuit: r.cuit,
    production: r.production,
    certPem: r.certPem,
    keyPem: r.keyPem,
    accessToken: r.accessToken,
    accessTokenEnvKey: r.accessTokenEnvKey,
  };
}

export function crearClienteAfip(cfg: AfipEnvConfig) {
  const opts: Record<string, unknown> = {
    CUIT: parseInt(cfg.cuit, 10),
    production: cfg.production,
    cert: cfg.certPem,
    key: cfg.keyPem,
  };
  if (cfg.accessToken) {
    opts.access_token = cfg.accessToken;
  }
  return new Afip(opts as ConstructorParameters<typeof Afip>[0]);
}
