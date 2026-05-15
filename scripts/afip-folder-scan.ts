/**
 * Analiza recursivamente una carpeta de certificados AFIP/ARCA (.crt, .pem, .key).
 * No imprime material de clave privada; solo metadatos y diagnóstico homo vs prod en rutas.
 *
 * Uso:
 *   npm run afip:folder-scan
 *   npx tsx scripts/afip-folder-scan.ts "D:/secure/afip"
 *
 * Carpeta por defecto: AFIP_SCAN_ROOT en .env o C:\\secure\\afip (Windows) / ./secure/afip (otros)
 */
import { config } from "dotenv";
import path from "node:path";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { envTrimmedKey } from "../lib/env-trim-key";
import { resolveOpenSslForAfip } from "../lib/afip/openssl";
import { loadAfipIntegrationEnv } from "../lib/afip/env";

const root = process.cwd();
const envLocal = path.resolve(root, ".env.local");
const envPlain = path.resolve(root, ".env");
const envDevelopment = path.resolve(root, ".env.development");
const envDevelopmentLocal = path.resolve(root, ".env.development.local");

config({ path: envPlain });
if (existsSync(envDevelopment)) config({ path: envDevelopment, override: true });
config({ path: envLocal, override: true });
if (existsSync(envDevelopmentLocal)) config({ path: envDevelopmentLocal, override: true });

const SCAN_EXTS = new Set([".crt", ".pem", ".cer", ".key"]);

function pathEnvTag(p: string): string[] {
  const n = p.replace(/\\/g, "/").toLowerCase();
  const tags: string[] = [];
  if (n.includes("/homo/") || n.includes("/homolog") || n.includes("\\homo\\")) tags.push("ruta-homologación");
  if (n.includes("/prod/") || n.includes("/production/") || n.includes("\\prod\\")) tags.push("ruta-producción");
  return tags;
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...walkFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function execOpenssl(opensslExe: string, args: string[]): string {
  return execFileSync(opensslExe, args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
}

function normalizePemText(content: string): string {
  return content.replace(/^\uFEFF/, "").replace(/^\uFFFE/, "").replace(/\r\n/g, "\n");
}

function pemBeginCount(content: string, marker: string): number {
  const re = new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
  return (content.match(re) || []).length;
}

/** Extrae cada bloque PEM X.509 (evita fallos de OpenSSL con BOM/UTF-16 o basura fuera del bloque). */
function extractCertificatePems(content: string): string[] {
  const s = normalizePemText(content);
  const re = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;
  return s.match(re)?.map((b) => (b.endsWith("\n") ? b : `${b}\n`)) ?? [];
}

/** Primeros bytes del archivo (UTF-8) para detectar PEM vs DER. */
function readFileHeadUtf8(filePath: string, maxBytes: number): string {
  const buf = readFileSync(filePath);
  return buf.subarray(0, Math.min(maxBytes, buf.length)).toString("utf8");
}

function isLikelyPemCertificateFile(filePath: string): boolean {
  return readFileHeadUtf8(filePath, 80).includes("-----BEGIN CERTIFICATE-----");
}

function classifyPem(content: string): "cert" | "private" | "mixed" | "unknown" {
  const c = normalizePemText(content).trim();
  const certs = pemBeginCount(c, "-----BEGIN CERTIFICATE-----");
  const pkcs8 = c.includes("-----BEGIN PRIVATE KEY-----");
  const rsa = c.includes("-----BEGIN RSA PRIVATE KEY-----");
  const ec = c.includes("-----BEGIN EC PRIVATE KEY-----");
  const encrypted = c.includes("-----BEGIN ENCRYPTED PRIVATE KEY-----");
  if (certs > 0 && (pkcs8 || rsa || ec || encrypted)) return "mixed";
  if (certs > 0) return "cert";
  if (pkcs8 || rsa || ec || encrypted) return "private";
  return "unknown";
}

function opensslX509Brief(opensslExe: string, certPath: string): string {
  const base = ["x509", "-inform", "PEM", "-in", certPath, "-noout"] as const;
  const subject = execOpenssl(opensslExe, [...base, "-subject"]).trim();
  const issuer = execOpenssl(opensslExe, [...base, "-issuer"]).trim();
  const dates = execOpenssl(opensslExe, [...base, "-dates"]).trim();
  const serial = execOpenssl(opensslExe, [...base, "-serial"]).trim();
  return `    ${subject}\n    ${issuer}\n    ${serial}\n    ${dates.replace(/\n/g, "\n    ")}`;
}

function opensslX509BriefDer(opensslExe: string, certPath: string): string {
  const base = ["x509", "-inform", "DER", "-in", certPath, "-noout"] as const;
  const subject = execOpenssl(opensslExe, [...base, "-subject"]).trim();
  const issuer = execOpenssl(opensslExe, [...base, "-issuer"]).trim();
  const dates = execOpenssl(opensslExe, [...base, "-dates"]).trim();
  const serial = execOpenssl(opensslExe, [...base, "-serial"]).trim();
  return `    ${subject}\n    ${issuer}\n    ${serial}\n    ${dates.replace(/\n/g, "\n    ")}`;
}

function analyzePrivateKey(opensslExe: string, keyPath: string): string {
  try {
    execOpenssl(opensslExe, ["rsa", "-in", keyPath, "-check", "-noout"]);
    return "tipo: RSA (openssl rsa -check OK)";
  } catch {
    try {
      execOpenssl(opensslExe, ["ec", "-in", keyPath, "-check", "-noout"]);
      return "tipo: EC (openssl ec -check OK)";
    } catch {
      try {
        execOpenssl(opensslExe, ["pkey", "-in", keyPath, "-noout"]);
        return "tipo: clave privada (pkey -noout OK; puede requerir contraseña en otro comando)";
      } catch (e) {
        return `no se pudo inspeccionar: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
  }
}

function analyzeCertPem(opensslExe: string, _filePath: string, content: string): void {
  const kind = classifyPem(content);
  const pems = extractCertificatePems(content);
  if (kind === "private" || kind === "mixed") {
    console.log("  ADVERTENCIA: PEM mezcla certificado(s) y clave privada en un solo archivo (inusual para AFIP web service).");
  }
  if (pems.length === 0) return;

  console.log(`  Certificados en archivo: ${pems.length}`);
  for (let idx = 0; idx < pems.length; idx++) {
    const onePem = pems[idx];
    const tmp = path.join(tmpdir(), `afip-scan-${Date.now()}-${idx}.pem`);
    try {
      writeFileSync(tmp, onePem, "utf8");
      if (pems.length > 1) {
        console.log(`  --- Certificado ${idx + 1}/${pems.length} ---`);
      }
      try {
        console.log(opensslX509Brief(opensslExe, tmp));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const oneLine = msg.replace(/\s+/g, " ").slice(0, 220);
        console.log(`  OpenSSL no decodificó este bloque PEM: ${oneLine}`);
        console.log("  Sugerencia: el .pem puede estar corrupto, en UTF-16, o no ser X.509; compará con el .crt equivalente.");
      }
    } finally {
      try {
        unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
  }
}

function analyzeFile(opensslExe: string, filePath: string): void {
  const ext = path.extname(filePath).toLowerCase();
  const rel = filePath;
  const st = statSync(filePath);
  const tags = pathEnvTag(filePath);
  console.log("");
  console.log("────────────────────────────────────────");
  console.log(rel);
  console.log(
    `  tamaño: ${st.size} bytes | etiquetas: ${tags.length ? tags.join(", ") : "(ninguna por carpeta)"}`,
  );

  if (ext === ".key") {
    console.log(`  clase: clave privada (.key)`);
    console.log(`  ${analyzePrivateKey(opensslExe, filePath)}`);
    return;
  }

  if (!SCAN_EXTS.has(ext) && ext !== "") return;

  if (ext === ".crt" || ext === ".cer") {
    console.log("  clase: certificado");
    const looksPem = isLikelyPemCertificateFile(filePath);
    try {
      if (looksPem) {
        console.log(opensslX509Brief(opensslExe, filePath));
      } else {
        console.log(opensslX509BriefDer(opensslExe, filePath));
        console.log("  (codificación DER; muchos .crt de AFIP/ARCA vienen así, no en PEM)");
      }
    } catch {
      try {
        if (looksPem) {
          console.log(opensslX509BriefDer(opensslExe, filePath));
          console.log(
            "  (OpenSSL no lo tomó como PEM; se leyó como DER — revisá si el archivo está corrupto o mezclado)",
          );
        } else {
          console.log(opensslX509Brief(opensslExe, filePath));
        }
      } catch (e) {
        console.log(`  OpenSSL no lo leyó como X.509 (PEM ni DER): ${e instanceof Error ? e.message : e}`);
        const head = readFileSync(filePath, "utf8").slice(0, 120);
        console.log(`  inicio archivo: ${head.replace(/\n/g, " ").slice(0, 80)}…`);
      }
    }
    return;
  }

  if (ext === ".pem") {
    const content = readFileSync(filePath, "utf8");
    const kind = classifyPem(content);
    console.log(`  clase PEM: ${kind}`);
    if (kind === "private") {
      const tmp = path.join(tmpdir(), `afip-scan-key-${Date.now()}.pem`);
      try {
        writeFileSync(tmp, content, "utf8");
        console.log(`  ${analyzePrivateKey(opensslExe, tmp)}`);
      } finally {
        try {
          unlinkSync(tmp);
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (kind === "cert" || kind === "mixed") {
      if (kind === "mixed") {
        console.log("  ADVERTENCIA: este PEM mezcla certificado(s) y clave privada (no se muestra la clave).");
      }
      analyzeCertPem(opensslExe, filePath, content);
      return;
    }
    console.log("  no se reconoció como PEM de certificado ni de clave privada estándar.");
  }
}

function defaultScanRoot(): string {
  const fromEnv = envTrimmedKey("AFIP_SCAN_ROOT");
  if (fromEnv) return path.resolve(fromEnv);
  if (process.platform === "win32") return String.raw`C:\secure\afip`;
  return path.resolve(process.cwd(), "secure/afip");
}

function main(): void {
  const scanRoot = path.resolve(process.argv[2] ?? defaultScanRoot());
  const opensslExe = resolveOpenSslForAfip(envTrimmedKey("OPENSSL_PATH"));

  console.log("OpenSSL:", opensslExe);
  console.log("Carpeta a analizar:", scanRoot);
  console.log("");

  if (!existsSync(scanRoot)) {
    console.error("La carpeta no existe:", scanRoot);
    console.error("Pasá la ruta como argumento o definí AFIP_SCAN_ROOT en .env");
    process.exit(1);
  }

  const all = walkFiles(scanRoot).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const relevant = all.filter((f) => SCAN_EXTS.has(path.extname(f).toLowerCase()));

  console.log(`Archivos relevantes (.crt/.pem/.cer/.key): ${relevant.length} de ${all.length} totales`);
  for (const f of relevant) {
    analyzeFile(opensslExe, f);
  }

  console.log("");
  console.log("=== Contraste con .env (si está cargado) ===");
  const loaded = loadAfipIntegrationEnv();
  if ("error" in loaded) {
    console.log("loadAfipIntegrationEnv:", loaded.error);
    return;
  }
  console.log("AFIP_PRODUCTION:", loaded.production);
  console.log("AFIP_CERT_PATH:", loaded.certPath);
  console.log("AFIP_KEY_PATH:", loaded.keyPath);
  console.log("AFIP_CHAIN_PATH:", loaded.chainPath ?? "(no definido)");
  const certTags = pathEnvTag(loaded.certPath);
  const keyTags = pathEnvTag(loaded.keyPath);
  const chainTags = loaded.chainPath ? pathEnvTag(loaded.chainPath) : [];
  if (loaded.production) {
    if (chainTags.some((t) => t.includes("homolog"))) {
      console.log("");
      console.log(
        "⚠️  ADVERTENCIA FUERTE: AFIP_PRODUCTION=true pero AFIP_CHAIN_PATH apunta a ruta de homologación.",
      );
      console.log(
        "   En producción deberías usar la cadena intermedia PEM de producción si AFIP te la entregó aparte.",
      );
    }
    if (certTags.includes("ruta-homologación") || keyTags.includes("ruta-homologación")) {
      console.log("⚠️  ADVERTENCIA: cert o key están bajo ruta que parece homologación con entorno producción.");
    }
  } else {
    if (
      chainTags.some((t) => t.includes("producción")) ||
      certTags.includes("ruta-producción") ||
      keyTags.includes("ruta-producción")
    ) {
      console.log("⚠️  ADVERTENCIA: entorno homologación (.env) pero alguna ruta parece de producción.");
    }
  }
}

main();
