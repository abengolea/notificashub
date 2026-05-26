/**
 * Sube a Firebase App Hosting los secretos definidos en apphosting.yaml,
 * tomando los valores desde un archivo .env (por defecto .env.local).
 *
 * Requisitos: `firebase` en PATH y sesión iniciada (`firebase login`).
 *
 * Uso:
 *   npm run secrets:push
 *   npm run secrets:push -- --dry-run
 *   npm run secrets:push -- --env-file .env.staging
 *   npm run secrets:keys          # solo lista nombres de variables encontradas
 *
 * Variables opcionales (shell):
 *   APPHOSTING_PROJECT_ID   (default: studio-3864746689-59018)
 *   APPHOSTING_BACKEND_ID   (default: notificashub)
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const keysOnly = args.includes("--keys");
const envFileArg = args.find((a) => a.startsWith("--env-file="))?.split("=")[1];
const envFile = path.resolve(root, envFileArg || process.env.ENV_FILE || ".env.local");

const projectId =
  process.env.APPHOSTING_PROJECT_ID?.trim() || "studio-3864746689-59018";
const backendId = process.env.APPHOSTING_BACKEND_ID?.trim() || "notificashub";

/** secret GCP → claves a probar en el archivo (primera con valor gana) */
const SECRET_MAP = [
  { secret: "NEXT_PUBLIC_FIREBASE_API_KEY", keys: ["NEXT_PUBLIC_FIREBASE_API_KEY"] },
  { secret: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", keys: ["NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"] },
  { secret: "NEXT_PUBLIC_FIREBASE_PROJECT_ID", keys: ["NEXT_PUBLIC_FIREBASE_PROJECT_ID"] },
  {
    secret: "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
    keys: ["NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"],
  },
  {
    secret: "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
    keys: ["NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"],
  },
  { secret: "NEXT_PUBLIC_FIREBASE_APP_ID", keys: ["NEXT_PUBLIC_FIREBASE_APP_ID"] },
  { secret: "NOTIFICAS_FIREBASE_PROJECT_ID", keys: ["NOTIFICAS_FIREBASE_PROJECT_ID"] },
  { secret: "NOTIFICAS_FIREBASE_CLIENT_EMAIL", keys: ["NOTIFICAS_FIREBASE_CLIENT_EMAIL"] },
  { secret: "NOTIFICAS_FIREBASE_PRIVATE_KEY", keys: ["NOTIFICAS_FIREBASE_PRIVATE_KEY"] },
  { secret: "WHATSAPP_VERIFY_TOKEN", keys: ["WHATSAPP_VERIFY_TOKEN"] },
  {
    secret: "whatsapp-access-token",
    keys: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_TOKEN", "META_WHATSAPP_ACCESS_TOKEN"],
  },
  {
    secret: "NOTIFICASHUB_URL",
    keys: ["NOTIFICASHUB_URL", "NEXT_PUBLIC_APP_URL", "APP_PUBLIC_BASE_URL"],
  },
  { secret: "GOOGLE_AI_API_KEY", keys: ["GOOGLE_AI_API_KEY", "GEMINI_API_KEY"] },
];

/** Parser simple (sin dotenv): soporta BOM, comillas y nombres con espacios raros. */
function parseEnvFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    let t = line.trim();
    if (!t || t.startsWith("#")) continue;
    if (t.startsWith("export ")) t = t.slice(7).trim();
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

function resolveValue(fileEnv, keys) {
  for (const key of keys) {
    const raw = fileEnv[key];
    if (raw == null) continue;
    let v = String(raw).trim();
    if (!v) continue;
    if (key.includes("PRIVATE_KEY")) {
      v = v.replace(/\\n/g, "\n");
    }
    return { value: v, fromKey: key };
  }
  return null;
}

function resolveFirebaseCommand() {
  const localBinCmd = path.join(root, "node_modules", ".bin", "firebase.cmd");
  if (fs.existsSync(localBinCmd)) {
    return { cmd: localBinCmd, prefix: [], shell: true };
  }
  return { cmd: "firebase", prefix: [], shell: true };
}

function runFirebase(argv, stdinBuffer) {
  return new Promise((resolve, reject) => {
    const { cmd, prefix, shell } = resolveFirebaseCommand();
    const useStdin = stdinBuffer != null;
    const child = spawn(cmd, [...prefix, ...argv], {
      stdio: useStdin ? ["pipe", "inherit", "inherit"] : ["ignore", "inherit", "inherit"],
      cwd: root,
      shell,
      windowsHide: true,
    });
    if (useStdin) {
      if (stdinBuffer.length) child.stdin.write(stdinBuffer);
      child.stdin.end();
    }
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`firebase terminó con código ${code}`));
    });
  });
}

async function setSecret(secretName, value) {
  const argv = [
    "apphosting:secrets:set",
    secretName,
    "--force",
    "--data-file",
    "-",
    "--project",
    projectId,
  ];
  if (dryRun) {
    console.log(`[dry-run] secrets:set ${secretName} (${value.length} chars)`);
    return;
  }
  await runFirebase(argv, Buffer.from(value, "utf8"));
}

async function grant(secretName) {
  const argv = [
    "apphosting:secrets:grantaccess",
    secretName,
    "--backend",
    backendId,
    "--project",
    projectId,
  ];
  if (dryRun) {
    console.log(`[dry-run] secrets:grantaccess ${secretName} → backend ${backendId}`);
    return;
  }
  await runFirebase(argv, null);
}

async function main() {
  if (!fs.existsSync(envFile)) {
    console.error(`No existe ${envFile}`);
    process.exit(1);
  }

  const fileEnv = parseEnvFile(envFile);

  if (keysOnly) {
    console.log(`Claves en ${envFile} (${Object.keys(fileEnv).length}):`);
    for (const k of Object.keys(fileEnv).sort()) {
      const hit = SECRET_MAP.find((m) => m.keys.includes(k));
      console.log(`  ${k}${hit ? ` → secreto ${hit.secret}` : ""}`);
    }
    console.log("\nMapeo esperado:");
    for (const { secret, keys } of SECRET_MAP) {
      const found = resolveValue(fileEnv, keys);
      console.log(
        `  ${secret}: ${found ? `OK (${found.fromKey})` : `falta — probá ${keys.join(" | ")}`}`
      );
    }
    return;
  }

  console.log(
    `App Hosting secrets — proyecto=${projectId} backend=${backendId}\nOrigen: ${envFile}${dryRun ? " (dry-run)" : ""}\n`
  );

  const skipped = [];
  const done = [];

  for (const { secret, keys } of SECRET_MAP) {
    const resolved = resolveValue(fileEnv, keys);
    if (!resolved) {
      skipped.push(`${secret} (falta ${keys.join(" o ")})`);
      continue;
    }
    console.log(`→ Subiendo ${secret} desde ${resolved.fromKey}…`);
    try {
      await setSecret(secret, resolved.value);
      console.log(`→ grantaccess ${secret} → ${backendId}`);
      await grant(secret);
      done.push(secret);
    } catch (e) {
      console.error(`Error con ${secret}:`, e?.message || e);
      process.exit(1);
    }
  }

  if (skipped.length) {
    console.log("\nOmitidos:");
    skipped.forEach((s) => console.log(`  - ${s}`));
    console.log(
      "\nTip: si tenés WHATSAPP_TOKEN, el script ya lo acepta. Ver nombres: npm run secrets:keys"
    );
    console.log(
      "O subí a mano: .\\scripts\\push-secrets-manual.ps1"
    );
  }
  console.log(`\nListo. Subidos: ${done.length}/${SECRET_MAP.length}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
