/**
 * Diagnóstico local: certificado AFIP/ARCA vs AFIP_CUIT y par .crt/.key (sin emitir facturas).
 *
 * Uso: npm run afip:cert-check
 */
import { config } from "dotenv";
import path from "node:path";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { loadAfipIntegrationEnv } from "../lib/afip/env";
import { envTrimmedKey } from "../lib/env-trim-key";
import { resolveOpenSslForAfip } from "../lib/afip/openssl";

const root = process.cwd();
const envLocal = path.resolve(root, ".env.local");
const envPlain = path.resolve(root, ".env");
const envDevelopment = path.resolve(root, ".env.development");
const envDevelopmentLocal = path.resolve(root, ".env.development.local");

config({ path: envPlain });
if (existsSync(envDevelopment)) config({ path: envDevelopment, override: true });
config({ path: envLocal, override: true });
if (existsSync(envDevelopmentLocal)) config({ path: envDevelopmentLocal, override: true });

function execOpenssl(opensslExe: string, args: string[]): string {
  try {
    return execFileSync(opensslExe, args, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (e) {
    const stderr =
      e && typeof e === "object" && "stderr" in e ? String((e as { stderr: unknown }).stderr) : "";
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(stderr?.trim() ? msg + ": " + stderr.slice(0, 400) : msg);
  }
}

function md5Utf8(s: string): string {
  return createHash("md5").update(s.trim(), "utf8").digest("hex");
}

function extractCn(subject: string): string {
  const m = subject.match(/CN\s*=\s*([^,/]+)/i);
  return m?.[1]?.trim() ?? "(no encontrado)";
}

function extractSerialNumberDn(subject: string): string {
  const m = subject.match(/serialNumber\s*=\s*([^,/]+)/i);
  return m?.[1]?.trim() ?? "";
}

function cuitInCertificateText(expectedDigits: string, text: string): boolean {
  if (!expectedDigits || expectedDigits.length !== 11) return false;
  if (text.includes(expectedDigits)) return true;
  const dashed = expectedDigits.replace(/^(\d{2})(\d{8})(\d{1})$/, "$1-$2-$3");
  return text.includes(dashed);
}

function modulusHash(opensslExe: string, args: string[]): string {
  const out = execOpenssl(opensslExe, args);
  return md5Utf8(out);
}

function keyModulusRsaOrNull(opensslExe: string, keyPath: string): string | null {
  try {
    return modulusHash(opensslExe, ["rsa", "-noout", "-modulus", "-in", keyPath]);
  } catch {
    return null;
  }
}

function pubkeyPairMatch(opensslExe: string, certPath: string, keyPath: string): boolean {
  const certPub = execOpenssl(opensslExe, ["x509", "-in", certPath, "-noout", "-pubkey"]);
  const keyPub = execOpenssl(opensslExe, ["pkey", "-in", keyPath, "-pubout"]);
  return createHash("sha256").update(certPub.trim(), "utf8").digest("hex") ===
    createHash("sha256").update(keyPub.trim(), "utf8").digest("hex");
}

function main(): void {
  const loaded = loadAfipIntegrationEnv();
  if ("error" in loaded) {
    console.error("Config:", loaded.error);
    process.exit(1);
  }

  const opensslExe = resolveOpenSslForAfip(loaded.opensslPath);
  const certPath = loaded.certPath;
  const keyPath = loaded.keyPath;
  const chainPath = loaded.chainPath;
  const expectedCuit = loaded.cuit;

  console.log("Ambiente:", loaded.production ? "producción" : "homologación");
  console.log("CUIT esperado:", expectedCuit);
  for (const w of loaded.warnings) {
    console.log(w);
  }
  console.log("Certificado encontrado:", certPath);
  console.log("Key encontrada:", keyPath);
  if (chainPath) {
    console.log("Chain:", existsSync(chainPath) ? chainPath : "(ruta configurada pero archivo no existe)");
  } else {
    console.log("Chain: (no configurado)");
  }
  console.log("OpenSSL:", opensslExe);
  console.log("");

  const subject = execOpenssl(opensslExe, ["x509", "-in", certPath, "-noout", "-subject"]).trim();
  const issuer = execOpenssl(opensslExe, ["x509", "-in", certPath, "-noout", "-issuer"]).trim();
  const dates = execOpenssl(opensslExe, ["x509", "-in", certPath, "-noout", "-dates"]).trim();
  const serialLine = execOpenssl(opensslExe, ["x509", "-in", certPath, "-noout", "-serial"]).trim();
  const textFull = execOpenssl(opensslExe, ["x509", "-in", certPath, "-noout", "-text"]);

  const cn = extractCn(subject);
  const serialDn = extractSerialNumberDn(subject);
  const notBefore = dates.match(/notBefore=(.+)/)?.[1]?.trim() ?? "(?)";
  const notAfter = dates.match(/notAfter=(.+)/)?.[1]?.trim() ?? "(?)";

  console.log("Subject:", subject);
  console.log("Issuer:", issuer);
  console.log("CN:", cn);
  console.log("serialNumber (Subject DN):", serialDn || "(no en Subject)");
  console.log("serial (X509):", serialLine);
  console.log("Vigencia Not Before:", notBefore);
  console.log("Vigencia Not After:", notAfter);
  console.log("");

  const haystack = `${subject}\n${issuer}\n${serialLine}\n${textFull}`;
  const cuitOk = cuitInCertificateText(expectedCuit, haystack);
  console.log("CUIT en certificado:", cuitOk ? "OK" : "ERROR");
  if (!cuitOk) {
    console.error(
      "→ El certificado no parece corresponder al CUIT AFIP_CUIT (" +
        expectedCuit +
        "): no se encontró ese CUIT (ni formato XX-XXXXXXXX-X) en Subject / serial / detalle.",
    );
  }

  const hashCertMod = modulusHash(opensslExe, ["x509", "-noout", "-modulus", "-in", certPath]);
  const hashKeyMod = keyModulusRsaOrNull(opensslExe, keyPath);

  let pairOk: boolean;
  if (hashKeyMod !== null) {
    pairOk = hashCertMod === hashKeyMod;
    console.log("Par CRT/KEY (MD5 del output modulus):", pairOk ? "OK: el certificado y la clave privada corresponden" : "ERROR");
    if (!pairOk) {
      console.error(
        "→ ERROR: el .crt y el .key NO corresponden (módulos distintos). Están cruzados o son de distintas generaciones.",
      );
      console.error("  MD5 módulo cert:", hashCertMod);
      console.error("  MD5 módulo key: ", hashKeyMod);
    }
  } else {
    pairOk = pubkeyPairMatch(opensslExe, certPath, keyPath);
    console.log(
      "Par CRT/KEY:",
      pairOk
        ? "OK: clave pública del cert y la privada coinciden (openssl rsa -modulus no aplicó; ¿clave no RSA?)"
        : "ERROR",
    );
    if (!pairOk) {
      console.error("→ ERROR: el .crt y el .key NO corresponden según la clave pública derivada.");
    }
  }

  if (!cuitOk || !pairOk) {
    process.exit(1);
  }
}

main();
