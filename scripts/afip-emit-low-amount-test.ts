/**
 * Emite una Factura B real de bajo importe para probar ARCA/WSFE en producción.
 *
 * Uso seguro:
 *   npx tsx scripts/afip-emit-low-amount-test.ts
 *
 * Emisión real:
 *   npx tsx scripts/afip-emit-low-amount-test.ts --emit-real-production-cae 20
 */
import { config } from "dotenv";
import path from "node:path";
import { existsSync } from "node:fs";
import { loadAfipIntegrationEnv } from "../lib/afip/env";
import { getAfipPtoVtaDefaultFromEnv } from "../lib/afip/issuer-env";
import { getWsaaTaForWsfe } from "../lib/afip/wsaa";
import { feCompUltimoAutorizado, feCAESolicitar } from "../lib/afip/wsfe";
import { armarDataCreateNextVoucher } from "../lib/afip/wsfe-voucher";
import { closeAfipTlsAgent } from "../lib/afip/fetch-afip";

const root = process.cwd();
for (const file of [".env", ".env.development", ".env.local", ".env.development.local"]) {
  const p = path.resolve(root, file);
  if (existsSync(p)) config({ path: p, override: true });
}

function ymdArgentina(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function main(): Promise<number> {
  const shouldEmit = process.argv.includes("--emit-real-production-cae");
  const amountArg = process.argv.find((x) => /^\d+(\.\d+)?$/.test(x));
  const total = round2(Number(amountArg ?? 20));

  if (!Number.isFinite(total) || total <= 0 || total > 1000) {
    console.error("Importe inválido. Usá un monto entre 0 y 1000 pesos.");
    return 1;
  }

  const env = loadAfipIntegrationEnv();
  if ("error" in env) {
    console.error("Config:", env.error);
    return 1;
  }

  const ptoVta = getAfipPtoVtaDefaultFromEnv();
  if (!ptoVta) {
    console.error("Falta AFIP_PTO_VTA.");
    return 1;
  }

  const fecha = ymdArgentina();
  const cbteTipo = 6; // Factura B
  const neto = round2(total / 1.21);
  const iva = round2(total - neto);

  console.log("Prueba emisión ARCA");
  console.log("Ambiente:", env.production ? "producción" : "homologación");
  console.log("CUIT emisor:", env.cuit);
  console.log("Punto de venta:", ptoVta);
  console.log("Tipo comprobante:", "Factura B (6)");
  console.log("Receptor:", "Consumidor final / DocTipo 99 / DocNro 0");
  console.log("Fecha:", fecha);
  console.log("Importes:", { neto, iva, total });

  if (!shouldEmit) {
    console.log("");
    console.log("No se emitió nada. Para emitir CAE real, ejecutá:");
    console.log(`npx tsx scripts/afip-emit-low-amount-test.ts --emit-real-production-cae ${total}`);
    return 0;
  }

  if (!env.production) {
    console.error("Este script está pensado para validar producción. AFIP_PRODUCTION no está en true.");
    return 1;
  }

  const voucherData = armarDataCreateNextVoucher({
    ptoVta,
    cbteTipo,
    letraComprobante: "B",
    fechaYMD: fecha,
    cuitCompradorDigits: "0",
    neto,
    iva,
    total,
    concepto: 2,
  });
  voucherData.DocTipo = 99;
  voucherData.DocNro = 0;

  const ta = await getWsaaTaForWsfe(env);
  const last = await feCompUltimoAutorizado(env, ta, ptoVta, cbteTipo);
  if (!last.ok) {
    console.error("Error consultando último comprobante:", last.errors);
    return 1;
  }

  const nextNumber = last.data.cbteNro + 1;
  console.log("Último comprobante:", last.data.cbteNro);
  console.log("Próximo comprobante a emitir:", nextNumber);

  const cae = await feCAESolicitar(env, ta, nextNumber, voucherData);
  if (!cae.ok) {
    console.error("Error solicitando CAE:", cae.errors, cae.rawHint ?? "");
    return 1;
  }

  console.log("");
  console.log("CAE emitido correctamente:");
  console.log({
    CAE: cae.data.cae,
    CAEFchVto: cae.data.caeFchVto,
    voucherNumber: cae.data.voucherNumber,
    ptoVta,
    cbteTipo,
    total,
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
