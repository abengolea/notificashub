import { XMLParser } from "fast-xml-parser";
import { afipWsfeUrl } from "@/lib/afip/env";
import type { AfipIntegrationEnv } from "@/lib/afip/env";
import { explainFetchFailure } from "@/lib/afip/fetch-error";
import { afipFetch } from "@/lib/afip/fetch-afip";
import { escapeXmlText } from "@/lib/afip/xml-escape";
import { debugTA, type WsaaCredentials } from "@/lib/afip/wsaa";
import type { Response as UndiciResponse } from "undici";

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  trimValues: true,
});

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

export type FeDummyStatus = {
  appServer: string;
  dbServer: string;
  authServer: string;
};

export type FeUltimoCbte = {
  ptoVta?: number;
  cbteTipo?: number;
  cbteNro: number;
};

export type AfipErr = { code: string; msg: string };

export type FeWsfeResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: AfipErr[]; rawHint?: string };

function collectAfipErrors(node: unknown, out: AfipErr[]): void {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const x of node) collectAfipErrors(x, out);
    return;
  }
  if (typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  if ("Code" in o && "Msg" in o && typeof o.Code !== "object" && typeof o.Msg !== "object") {
    out.push({ code: String(o.Code), msg: String(o.Msg) });
  }
  for (const v of Object.values(o)) {
    collectAfipErrors(v, out);
  }
}

function extractErrors(parsed: Record<string, unknown>): AfipErr[] {
  const errorsRoot = findDeep(parsed, "Errors");
  const out: AfipErr[] = [];
  if (errorsRoot !== undefined) collectAfipErrors(errorsRoot, out);
  return out;
}

async function postSoap(url: string, soapAction: string, body: string): Promise<string> {
  let res: UndiciResponse;
  try {
    res = await afipFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: `"${soapAction}"`,
      },
      body,
    });
  } catch (e) {
    throw new Error(explainFetchFailure(url, e));
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`WSFE HTTP ${res.status} (recorte): ${text.slice(0, 500)}`);
  }
  return text;
}

/** FEDummy — estado de servicios WSFE. */
export async function feDummy(env: AfipIntegrationEnv): Promise<FeWsfeResult<FeDummyStatus>> {
  const soap = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soap:Body>
    <ar:FEDummy/>
  </soap:Body>
</soap:Envelope>`;
  const url = afipWsfeUrl(env.production);
  let text: string;
  try {
    text = await postSoap(url, "http://ar.gov.afip.dif.FEV1/FEDummy", soap);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      errors: [
        {
          code: "FETCH",
          msg: `${msg}. Si es red/TLS: probá desde el navegador la URL, firewall, VPN, proxy (HTTPS_PROXY), o antivirus que intercepte HTTPS.`,
        },
      ],
    };
  }
  const parsed = parser.parse(text) as Record<string, unknown>;
  const fault = findDeep(parsed, "Fault");
  if (fault !== undefined) {
    return {
      ok: false,
      errors: [{ code: "SOAP", msg: JSON.stringify(fault).slice(0, 400) }],
    };
  }
  const app = findDeep(parsed, "AppServer");
  const db = findDeep(parsed, "DbServer");
  const auth = findDeep(parsed, "AuthServer");
  if (typeof app !== "string" || typeof db !== "string" || typeof auth !== "string") {
    return { ok: false, errors: [], rawHint: text.slice(0, 300) };
  }
  return { ok: true, data: { appServer: app, dbServer: db, authServer: auth } };
}

/** FECompUltimoAutorizado — último número de comprobante autorizado. */
export async function feCompUltimoAutorizado(
  env: AfipIntegrationEnv,
  ta: WsaaCredentials,
  ptoVta: number,
  cbteTipo: number,
): Promise<FeWsfeResult<FeUltimoCbte>> {
  // FIX: validar el TA antes de enviar — detecta service incorrecto (causa directa del error 600)
  // ta.token es base64 del XML interno del ticket (tiene <service>); loginTicketXml es el wrapper externo que NO lo tiene
  debugTA(ta.token);
  const esc = escapeXmlText;
  const soap = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soap:Body>
    <ar:FECompUltimoAutorizado>
      <ar:Auth>
        <ar:Token>${esc(ta.token)}</ar:Token>
        <ar:Sign>${esc(ta.sign)}</ar:Sign>
        <ar:Cuit>${env.cuitNumeric}</ar:Cuit>
      </ar:Auth>
      <ar:PtoVta>${ptoVta}</ar:PtoVta>
      <ar:CbteTipo>${cbteTipo}</ar:CbteTipo>
    </ar:FECompUltimoAutorizado>
  </soap:Body>
</soap:Envelope>`;
  const url = afipWsfeUrl(env.production);
  let text: string;
  try {
    text = await postSoap(url, "http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado", soap);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      errors: [
        {
          code: "FETCH",
          msg: `${msg}. Revisá conectividad a AFIP (proxy/firewall/VPN).`,
        },
      ],
    };
  }
  const parsed = parser.parse(text) as Record<string, unknown>;
  const fault = findDeep(parsed, "Fault");
  if (fault !== undefined) {
    return {
      ok: false,
      errors: [{ code: "SOAP", msg: JSON.stringify(fault).slice(0, 400) }],
    };
  }
  const errs = extractErrors(parsed);
  const cbteNroRaw = findDeep(parsed, "CbteNro");
  const ptoRaw = findDeep(parsed, "PtoVta");
  const tipoRaw = findDeep(parsed, "CbteTipo");
  const cbteNro =
    typeof cbteNroRaw === "number" ? cbteNroRaw : parseInt(String(cbteNroRaw ?? "0"), 10);
  if (errs.length > 0) {
    return { ok: false, errors: errs };
  }
  if (!Number.isFinite(cbteNro)) {
    return { ok: false, errors: [], rawHint: text.slice(0, 400) };
  }
  const ptoVtaR = typeof ptoRaw === "number" ? ptoRaw : parseInt(String(ptoRaw ?? "0"), 10);
  const cbteTipoR = typeof tipoRaw === "number" ? tipoRaw : parseInt(String(tipoRaw ?? "0"), 10);
  return {
    ok: true,
    data: {
      cbteNro,
      ptoVta: Number.isFinite(ptoVtaR) ? ptoVtaR : undefined,
      cbteTipo: Number.isFinite(cbteTipoR) ? cbteTipoR : undefined,
    },
  };
}

export type FeCaeResult = {
  cae: string;
  caeFchVto: string;
  voucherNumber: number;
};

function buildIvaXml(iva: Array<{ Id: number; BaseImp: number; Importe: number }>): string {
  if (!iva.length) return "";
  const items = iva
    .map(
      (a) =>
        `<ar:AlicIva><ar:Id>${a.Id}</ar:Id><ar:BaseImp>${a.BaseImp}</ar:BaseImp><ar:Importe>${a.Importe}</ar:Importe></ar:AlicIva>`,
    )
    .join("");
  return `<ar:Iva>${items}</ar:Iva>`;
}

/** FECAESolicitar — solicita CAE para un comprobante. voucherNro = último + 1. */
export async function feCAESolicitar(
  env: AfipIntegrationEnv,
  ta: WsaaCredentials,
  voucherNro: number,
  data: Record<string, unknown>,
): Promise<FeWsfeResult<FeCaeResult>> {
  debugTA(ta.token);
  const esc = escapeXmlText;

  const ptoVta = data.PtoVta as number;
  const cbteTipo = data.CbteTipo as number;
  const concepto = data.Concepto as number;
  const ivaArr = Array.isArray(data.Iva)
    ? (data.Iva as Array<{ Id: number; BaseImp: number; Importe: number }>)
    : [];

  const periodoXml =
    concepto === 2 || concepto === 3
      ? `<ar:FchServDesde>${data.FchServDesde}</ar:FchServDesde>` +
        `<ar:FchServHasta>${data.FchServHasta}</ar:FchServHasta>` +
        `<ar:FchVtoPago>${data.FchVtoPago}</ar:FchVtoPago>`
      : "";

  const soap = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soap:Body>
    <ar:FECAESolicitar>
      <ar:Auth>
        <ar:Token>${esc(ta.token)}</ar:Token>
        <ar:Sign>${esc(ta.sign)}</ar:Sign>
        <ar:Cuit>${env.cuitNumeric}</ar:Cuit>
      </ar:Auth>
      <ar:FeCAEReq>
        <ar:FeCabReq>
          <ar:CantReg>1</ar:CantReg>
          <ar:PtoVta>${ptoVta}</ar:PtoVta>
          <ar:CbteTipo>${cbteTipo}</ar:CbteTipo>
        </ar:FeCabReq>
        <ar:FeDetReq>
          <ar:FECAEDetRequest>
            <ar:Concepto>${concepto}</ar:Concepto>
            <ar:DocTipo>${data.DocTipo}</ar:DocTipo>
            <ar:DocNro>${data.DocNro}</ar:DocNro>
            <ar:CbteDesde>${voucherNro}</ar:CbteDesde>
            <ar:CbteHasta>${voucherNro}</ar:CbteHasta>
            <ar:CbteFch>${data.CbteFch}</ar:CbteFch>
            <ar:ImpTotal>${data.ImpTotal}</ar:ImpTotal>
            <ar:ImpTotConc>${data.ImpTotConc}</ar:ImpTotConc>
            <ar:ImpNeto>${data.ImpNeto}</ar:ImpNeto>
            <ar:ImpOpEx>${data.ImpOpEx}</ar:ImpOpEx>
            <ar:ImpIVA>${data.ImpIVA}</ar:ImpIVA>
            <ar:ImpTrib>${data.ImpTrib}</ar:ImpTrib>
            ${periodoXml}
            <ar:MonId>${data.MonId}</ar:MonId>
            <ar:MonCotiz>${data.MonCotiz}</ar:MonCotiz>
            ${buildIvaXml(ivaArr)}
          </ar:FECAEDetRequest>
        </ar:FeDetReq>
      </ar:FeCAEReq>
    </ar:FECAESolicitar>
  </soap:Body>
</soap:Envelope>`;

  const url = afipWsfeUrl(env.production);
  let text: string;
  try {
    text = await postSoap(url, "http://ar.gov.afip.dif.FEV1/FECAESolicitar", soap);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, errors: [{ code: "FETCH", msg }] };
  }

  const parsed = parser.parse(text) as Record<string, unknown>;
  const fault = findDeep(parsed, "Fault");
  if (fault !== undefined) {
    return { ok: false, errors: [{ code: "SOAP", msg: JSON.stringify(fault).slice(0, 400) }] };
  }

  const errs = extractErrors(parsed);
  if (errs.length > 0) {
    return { ok: false, errors: errs };
  }

  const cae = findDeep(parsed, "CAE");
  const caeFchVto = findDeep(parsed, "CAEFchVto");
  const cbteDesdeRaw = findDeep(parsed, "CbteDesde");

  if (typeof cae !== "string" || !cae) {
    return { ok: false, errors: [], rawHint: text.slice(0, 600) };
  }

  const voucherNumber =
    typeof cbteDesdeRaw === "number"
      ? cbteDesdeRaw
      : parseInt(String(cbteDesdeRaw ?? voucherNro), 10);

  return {
    ok: true,
    data: {
      cae,
      caeFchVto: typeof caeFchVto === "string" ? caeFchVto : String(caeFchVto ?? ""),
      voucherNumber,
    },
  };
}
