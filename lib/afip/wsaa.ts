import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { randomInt } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import type { AfipIntegrationEnv } from "@/lib/afip/env";
import { afipWsaaUrl } from "@/lib/afip/env";
import { explainFetchFailure } from "@/lib/afip/fetch-error";
import { afipFetch } from "@/lib/afip/fetch-afip";
import { resolveOpenSslForAfip, signTraWithOpenSslDer } from "@/lib/afip/openssl";
import { escapeXmlText } from "@/lib/afip/xml-escape";
import type { Response as UndiciResponse } from "undici";

const SERVICE_WSFE = "wsfe";

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  trimValues: true,
});

export type WsaaCredentials = {
  token: string;
  sign: string;
  expirationTimeMs: number;
  loginTicketXml?: string; // FIX: guarda el loginTicketResponse XML completo para debugTA
};

function buildTraXml(uniqueId: number): string {
  const gen = new Date(Date.now() - 10 * 60 * 1000);
  const exp = new Date(Date.now() + 10 * 60 * 1000); // FIX: +10min per AFIP spec (era +50min)
  const fmt = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    // FIX: +00:00 es UTC válido per RFC 3339; -00:00 es ambiguo y algunos parsers lo rechazan
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${uniqueId}</uniqueId>
    <generationTime>${fmt(gen)}</generationTime>
    <expirationTime>${fmt(exp)}</expirationTime>
  </header>
  <service>${SERVICE_WSFE}</service>
</loginTicketRequest>`;
}

function parseAfipExpirationTime(raw: string): number | null {
  const s = raw.trim();
  if (/^\d{14}$/.test(s)) {
    const y = parseInt(s.slice(0, 4), 10);
    const mo = parseInt(s.slice(4, 6), 10) - 1;
    const d = parseInt(s.slice(6, 8), 10);
    const h = parseInt(s.slice(8, 10), 10);
    const mi = parseInt(s.slice(10, 12), 10);
    const se = parseInt(s.slice(12, 14), 10);
    return Date.UTC(y, mo, d, h, mi, se); // FIX: usar UTC (new Date local difería hasta 3h con servidor en otra zona)
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function findDeep(obj: unknown, key: string): unknown {
  if (obj === null || typeof obj !== "object") return undefined;
  const o = obj as Record<string, unknown>;
  if (key in o) return o[key];
  for (const v of Object.values(o)) {
    const f = findDeep(v, key);
    if (f !== undefined) return f;
  }
  return undefined;
}

function extractCredentialsFromLoginTicketXml(innerXml: string): WsaaCredentials {
  const inner = parser.parse(innerXml) as Record<string, unknown>;
  const token = findDeep(inner, "token");
  const sign = findDeep(inner, "sign");
  const expRaw = findDeep(inner, "expirationTime");
  if (typeof token !== "string" || typeof sign !== "string") {
    throw new Error("Respuesta WSAA: no se encontraron token/sign en loginTicketResponse.");
  }
  const expStr = typeof expRaw === "string" ? expRaw : String(expRaw ?? "");
  const expirationTimeMs = parseAfipExpirationTime(expStr);
  if (expirationTimeMs === null) {
    throw new Error("Respuesta WSAA: expirationTime no reconocido.");
  }
  return { token, sign, expirationTimeMs, loginTicketXml: innerXml }; // FIX: guardar XML completo para debugTA
}

// FIX: incluir cuit en el nombre para evitar reutilizar TA de otro certificado/CUIT
// (antes era ta_wsfe_env_prod.json sin CUIT — si el cert cambiaba, el TA viejo causaba error 600)
function taCachePath(workDir: string, production: boolean, cuit: string): string {
  const env = production ? "prod" : "homo";
  return path.join(workDir, `ta_wsfe_${env}_${cuit}.json`);
}

function loadTaFromCache(workDir: string, production: boolean, cuit: string): WsaaCredentials | null { // FIX: cuit param
  const p = taCachePath(workDir, production, cuit); // FIX: incluir cuit
  if (!existsSync(p)) return null;
  try {
    const raw = readFileSync(p, "utf8");
    const j = JSON.parse(raw) as {
      token?: string;
      sign?: string;
      expirationTimeMs?: number;
      loginTicketXml?: string; // FIX: campo nuevo para debugTA
    };
    if (typeof j.token !== "string" || typeof j.sign !== "string" || typeof j.expirationTimeMs !== "number") {
      return null;
    }
    const skewMs = 5 * 60 * 1000;
    if (Date.now() + skewMs >= j.expirationTimeMs) {
      return null;
    }
    return { token: j.token, sign: j.sign, expirationTimeMs: j.expirationTimeMs, loginTicketXml: j.loginTicketXml }; // FIX: incluir loginTicketXml
  } catch {
    return null;
  }
}

function saveTaCache(workDir: string, production: boolean, cuit: string, cred: WsaaCredentials): void { // FIX: cuit param
  const p = taCachePath(workDir, production, cuit); // FIX: incluir cuit
  writeFileSync(
    p,
    JSON.stringify(
      {
        expirationTimeMs: cred.expirationTimeMs,
        token: cred.token,
        sign: cred.sign,
        loginTicketXml: cred.loginTicketXml, // FIX: persistir XML para debugTA en próximas llamadas
      },
      null,
      2,
    ),
    "utf8",
  );
}

/**
 * Decodifica y valida el Token de Acceso (TA) de WSAA antes de enviarlo a WSFEv1.
 * Acepta el loginTicketResponse XML directamente, o intenta decodificar desde base64.
 * Lanza un error descriptivo si <service> !== 'wsfe' o falta CUIT en <destination>.
 * Llamar con `ta.loginTicketXml ?? ta.token` justo antes de armar el Auth SOAP.
 */
export function debugTA(token: string): void {
  let xml = token;

  // Intentar decodificar desde base64 si no parece XML directo
  if (!token.startsWith("<?xml") && !token.startsWith("<")) {
    try {
      const decoded = Buffer.from(token, "base64").toString("utf8");
      xml = decoded;
    } catch {
      console.warn("[debugTA] Token no decodificable desde base64; usando como texto plano.");
    }
  }

  console.log("[debugTA] TA XML (primeros 1000 chars):\n", xml.slice(0, 1000));

  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(xml) as Record<string, unknown>;
  } catch {
    // FIX: el token opaco de WSAA no es XML — loguear advertencia pero no bloquear
    console.warn("[debugTA] No se pudo parsear el TA como XML. El token puede ser opaco (binario DER). Verificar manualmente que service=wsfe en ARCA.");
    return;
  }

  const service = findDeep(parsed, "service");
  const destination = findDeep(parsed, "destination");
  const expirationTime = findDeep(parsed, "expirationTime");

  console.log("[debugTA] <service>:", service ?? "(no encontrado)");
  console.log("[debugTA] <destination>:", destination ?? "(no encontrado)");
  console.log("[debugTA] <expirationTime>:", expirationTime ?? "(no encontrado)");

  // Validar service — causa directa del error 600 ValidacionDeToken
  if (typeof service === "string") {
    if (service !== SERVICE_WSFE) {
      throw new Error(
        `[debugTA] ERROR CRÍTICO: <service> en el TA es "${service}" pero WSFEv1 requiere "${SERVICE_WSFE}". ` +
        `Esto causa error 600 "lista de relaciones". Borrá el caché en AFIP_WORK_DIR y reintentá.`,
      );
    }
    console.log(`[debugTA] ✓ <service> = "${service}" (correcto)`);
  } else {
    console.warn(`[debugTA] ⚠ <service> no encontrado en el TA XML. Verificar contenido del ticket manualmente.`);
  }

  // Extraer y validar CUIT del destinatario
  if (typeof destination === "string") {
    const cuitInDest = destination.match(/\b(\d{11})\b/);
    if (cuitInDest) {
      console.log(`[debugTA] CUIT en <destination>: ${cuitInDest[1]}`);
    } else {
      throw new Error(
        `[debugTA] ERROR: No se encontró CUIT (11 dígitos) en <destination>: "${destination}". ` +
        `El certificado puede no corresponder al CUIT emisor. Verificar alias en ARCA.`,
      );
    }
  } else {
    console.warn("[debugTA] ⚠ <destination> no encontrado en el TA XML.");
  }
}

function buildSoapLoginCms(base64Cms: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
<soapenv:Header/>
<soapenv:Body>
  <wsaa:loginCms>
    <wsaa:in0>${escapeXmlText(base64Cms)}</wsaa:in0>
  </wsaa:loginCms>
</soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Obtiene TA/Sign para WSFE (cache en AFIP_WORK_DIR si está vigente).
 */
export async function getWsaaTaForWsfe(env: AfipIntegrationEnv): Promise<WsaaCredentials> {
  const cached = loadTaFromCache(env.workDir, env.production, env.cuit); // FIX: incluir cuit para evitar reutilizar TA de otro cert
  if (cached) {
    return cached;
  }

  const opensslExe = resolveOpenSslForAfip(env.opensslPath);

  const uniqueId = randomInt(1, 99_999_999);
  const traXml = buildTraXml(uniqueId);
  const traPath = path.join(env.workDir, `tra_${uniqueId}.xml`);
  const cmsPath = path.join(env.workDir, `tra_${uniqueId}.cms`);
  writeFileSync(traPath, traXml, "utf8");

  try {
    signTraWithOpenSslDer({
      opensslExe,
      traXmlPath: traPath,
      certPath: env.certPath,
      keyPath: env.keyPath,
      chainPemPath: env.chainPath,
      cmsDerOutPath: cmsPath,
    });
  } finally {
    try {
      unlinkSync(traPath);
    } catch {
      /* ignore */
    }
  }

  const cmsBuf = readFileSync(cmsPath);
  try {
    unlinkSync(cmsPath);
  } catch {
    /* ignore */
  }

  const base64Cms = cmsBuf.toString("base64");
  const soap = buildSoapLoginCms(base64Cms);
  const url = afipWsaaUrl(env.production);

  let res: UndiciResponse;
  try {
    res = await afipFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: '""',
      },
      body: soap,
    });
  } catch (e) {
    throw new Error(`${explainFetchFailure(url, e)}. Revisá red, proxy (HTTPS_PROXY), firewall o VPN.`);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`WSAA HTTP ${res.status} (cuerpo recortado): ${text.slice(0, 400)}`);
  }

  const parsed = parser.parse(text) as Record<string, unknown>;
  const fault = findDeep(parsed, "Fault");
  if (fault !== undefined) {
    const faultStr = JSON.stringify(fault).slice(0, 600);
    throw new Error(`WSAA SOAP Fault: ${faultStr}`);
  }

  const ret = findDeep(parsed, "loginCmsReturn");
  if (typeof ret !== "string") {
    throw new Error("WSAA: respuesta sin loginCmsReturn string.");
  }

  const innerTrim = ret.trim();
  const cred = extractCredentialsFromLoginTicketXml(innerTrim);
  saveTaCache(env.workDir, env.production, env.cuit, cred); // FIX: incluir cuit
  return cred;
}
