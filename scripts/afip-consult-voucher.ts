/**
 * Consulta un comprobante ya autorizado en AFIP/ARCA.
 *
 * Uso:
 *   npx tsx scripts/afip-consult-voucher.ts 1 6 2
 */
import { config } from "dotenv";
import path from "node:path";
import { existsSync } from "node:fs";
import { loadAfipIntegrationEnv } from "../lib/afip/env";
import { getWsaaTaForWsfe } from "../lib/afip/wsaa";
import { feCompConsultar } from "../lib/afip/wsfe";
import { closeAfipTlsAgent } from "../lib/afip/fetch-afip";

const root = process.cwd();
for (const file of [".env", ".env.development", ".env.local", ".env.development.local"]) {
  const p = path.resolve(root, file);
  if (existsSync(p)) config({ path: p, override: true });
}

async function main(): Promise<number> {
  const ptoVta = Number(process.argv[2]);
  const cbteTipo = Number(process.argv[3]);
  const cbteNro = Number(process.argv[4]);
  if (!Number.isInteger(ptoVta) || !Number.isInteger(cbteTipo) || !Number.isInteger(cbteNro)) {
    console.error("Uso: npx tsx scripts/afip-consult-voucher.ts <ptoVta> <cbteTipo> <cbteNro>");
    return 1;
  }

  const env = loadAfipIntegrationEnv();
  if ("error" in env) {
    console.error("Config:", env.error);
    return 1;
  }

  const ta = await getWsaaTaForWsfe(env);
  const res = await feCompConsultar(env, ta, ptoVta, cbteTipo, cbteNro);
  if (!res.ok) {
    console.error("No se pudo consultar:", res.errors, res.rawHint ?? "");
    return 1;
  }

  console.log("Comprobante autorizado:");
  console.log({
    ptoVta,
    cbteTipo,
    cbteNro,
    CAE: res.data.cae,
    CAEFchVto: res.data.caeFchVto,
    resultado: res.data.resultado,
    total: res.data.impTotal,
  });
  return 0;
}

void (async () => {
  let code = 1;
  try {
    code = await main();
  } finally {
    await closeAfipTlsAgent().catch(() => undefined);
  }
  process.exit(code);
})();
