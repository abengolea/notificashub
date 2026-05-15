/**
 * Prueba de conectividad AFIP:
 * - Con AFIP_ACCESS_TOKEN: modo relay @afipsdk/afip.js (como antes).
 * - Sin token: WSAA propio (OpenSSL + cert) + WSFEv1 SOAP directo.
 *
 * Uso:
 *   npm run afip:ping
 *   npx tsx scripts/afip-ping.ts [ptoVta] [cbteTipo]
 */
import { config } from "dotenv";
import path from "node:path";
import { existsSync } from "node:fs";
import { loadAfipIntegrationEnv } from "../lib/afip/env";
import { crearClienteAfip } from "../lib/afip/sdk-client";
import { envTrimmedKey } from "../lib/env-trim-key";
import { getAfipPtoVtaDefaultFromEnv } from "../lib/afip/issuer-env";
import { getWsaaTaForWsfe } from "../lib/afip/wsaa";
import { feCompUltimoAutorizado, feDummy } from "../lib/afip/wsfe";
import { closeAfipTlsAgent } from "../lib/afip/fetch-afip";

function httpStatusFromError(e: unknown): number | undefined {
  if (!e || typeof e !== "object") return undefined;
  const o = e as Record<string, unknown>;
  if (typeof o.status === "number") return o.status;
  const res = o.response;
  if (res && typeof res === "object" && typeof (res as { status?: unknown }).status === "number") {
    return (res as { status: number }).status;
  }
  return undefined;
}

const root = process.cwd();
const envLocal = path.resolve(root, ".env.local");
const envPlain = path.resolve(root, ".env");
const envDevelopment = path.resolve(root, ".env.development");
const envDevelopmentLocal = path.resolve(root, ".env.development.local");

config({ path: envPlain });
if (existsSync(envDevelopment)) config({ path: envDevelopment, override: true });
config({ path: envLocal, override: true });
if (existsSync(envDevelopmentLocal)) config({ path: envDevelopmentLocal, override: true });

function diagnosticarCuitAfip(): void {
  const tieneLocal = existsSync(envLocal);
  const tieneEnv = existsSync(envPlain);
  console.error("Carpeta del proyecto:", root);
  console.error(".env.local:", tieneLocal ? envLocal : "(no existe)");
  console.error(".env:     ", tieneEnv ? envPlain : "(no existe)");

  const raw = envTrimmedKey("AFIP_CUIT") ?? process.env.AFIP_CUIT;
  const digits = (raw ?? "").replace(/\D/g, "");
  if (raw === undefined || String(raw).trim() === "") {
    console.error("AFIP_CUIT: no está definido tras cargar .env.");
  } else if (digits.length !== 11) {
    console.error(`AFIP_CUIT: ${digits.length} dígitos (se necesitan 11).`);
  }
}

function printAr600ListaRelacionesHint(cuit: string): void {
  console.error("");
  console.error(
    "ARCA (código 600 — lista de relaciones): WSFE no acepta el CUIT del ticket para esta operación.",
  );
  console.error("Revisá en ARCA / clave fiscal:");
  console.error(`- El certificado usado corresponde al CUIT ${cuit} (mismo titular).`);
  console.error("- WSFE y el punto de venta están habilitados para web services.");
  console.error("- Si el cert es de representante: el CUIT debe estar en relaciones delegadas.");
  console.error("- Alineá AFIP_PRODUCTION con certificados homo vs prod.");
}

/** Devuelve código de salida (no usar process.exit dentro: permite cerrar undici en Windows). */
async function main(): Promise<number> {
  const loaded = loadAfipIntegrationEnv();
  if ("error" in loaded) {
    console.error("Config:", loaded.error);
    if (loaded.error.includes("AFIP_CUIT")) {
      console.error("");
      diagnosticarCuitAfip();
    }
    return 1;
  }

  for (const w of loaded.warnings) {
    console.log(w);
  }

  const ptoFromEnv = getAfipPtoVtaDefaultFromEnv();
  const ptoVta = process.argv[2] ? parseInt(process.argv[2], 10) : ptoFromEnv;
  const cbteTipo = process.argv[3] ? parseInt(process.argv[3], 10) : 1;

  if (!ptoVta || Number.isNaN(ptoVta)) {
    console.error("Falta AFIP_PTO_VTA o pasá el PV: npx tsx scripts/afip-ping.ts 1");
    return 1;
  }

  if (![1, 6, 11].includes(cbteTipo)) {
    console.error("CbteTipo debe ser 1, 6 u 11.");
    return 1;
  }

  console.log("Ambiente:", loaded.production ? "producción" : "homologación");
  console.log("CUIT emisor:", loaded.cuit);
  console.log("Punto de venta:", ptoVta, "| Tipo comprobante (consulta):", cbteTipo);

  const useSdk = Boolean(loaded.accessToken);

  if (useSdk) {
    console.log("Modo: AFIP SDK (relay app.afipsdk.com)");
    if (loaded.accessTokenEnvKey) {
      console.log(`Token relay: definido vía ${loaded.accessTokenEnvKey} (longitud no mostrada).`);
    }
    const afip = crearClienteAfip({
      cuit: loaded.cuit,
      production: loaded.production,
      certPem: loaded.certPem,
      keyPem: loaded.keyPem,
      accessToken: loaded.accessToken,
      accessTokenEnvKey: loaded.accessTokenEnvKey,
    });

    try {
      const status = await afip.ElectronicBilling.getServerStatus();
      const allOk =
        status &&
        typeof status === "object" &&
        (status as { AppServer?: string }).AppServer === "OK" &&
        (status as { DbServer?: string }).DbServer === "OK" &&
        (status as { AuthServer?: string }).AuthServer === "OK";
      console.log(
        "\nEstado WSFE:",
        allOk ? "OK" : JSON.stringify(status, null, 2),
      );

      const last = await afip.ElectronicBilling.getLastVoucher(ptoVta, cbteTipo);
      console.log("\nÚltimo comprobante autorizado:", last);
      console.log("\nConexión OK (AFIP SDK).");
      return 0;
    } catch (e) {
      console.error("\nFallo:", e instanceof Error ? e.message : e);
      if (e && typeof e === "object" && "data" in e) {
        console.error("Detalle:", JSON.stringify((e as { data: unknown }).data, null, 2));
      }
      const status = httpStatusFromError(e);
      if (status === 401) {
        console.error(
          "\n401: revisá AFIP_ACCESS_TOKEN o alineá AFIP_PRODUCTION con el tipo de token del panel Afip SDK.",
        );
      }
      return 1;
    }
  }

  console.log("Modo: WSAA propio con certificado");

  try {
    const dummy = await feDummy(loaded);
    if (!dummy.ok) {
      if (dummy.errors.length) {
        console.error("Errores FEDummy:", JSON.stringify(dummy.errors, null, 2));
      }
      if (dummy.rawHint) console.error("Recorte respuesta:", dummy.rawHint);
      return 1;
    }
    const s = dummy.data;
    const wsfeOk = s.appServer === "OK" && s.dbServer === "OK" && s.authServer === "OK";
    console.log("\nEstado WSFE:", wsfeOk ? "OK" : `App=${s.appServer} Db=${s.dbServer} Auth=${s.authServer}`);

    const ta = await getWsaaTaForWsfe(loaded);
    console.log("WSAA: ticket obtenido o reutilizado (caché en AFIP_WORK_DIR).");

    const ult = await feCompUltimoAutorizado(loaded, ta, ptoVta, cbteTipo);
    if (!ult.ok) {
      if (ult.errors.length) {
        console.error("Errores FECompUltimoAutorizado:", JSON.stringify(ult.errors, null, 2));
        if (
          ult.errors.some(
            (err) =>
              err.code === "600" &&
              /lista de relaciones|ValidacionDeToken/i.test(err.msg),
          )
        ) {
          printAr600ListaRelacionesHint(loaded.cuit);
        }
      }
      if (ult.rawHint) console.error("Recorte respuesta:", ult.rawHint);
      return 1;
    }
    console.log("\nÚltimo comprobante autorizado:", ult.data.cbteNro);
    console.log("\nConexión OK (WSAA + WSFE nativo).");
    return 0;
  } catch (e) {
    console.error("\nFallo:", e instanceof Error ? e.message : e);
    return 1;
  }
}

void (async () => {
  let code = 0;
  try {
    code = await main();
  } catch (e) {
    console.error(e);
    code = 1;
  } finally {
    try {
      await closeAfipTlsAgent();
    } catch {
      /* ignore */
    }
  }
  // Windows + undici: salir en el mismo tick que agent.close() puede disparar
  // "Assertion failed: UV_HANDLE_CLOSING" en libuv; un tick de demora evita la condición de carrera.
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
  process.exit(code);
})();
