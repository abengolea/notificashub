/**
 * Cargar WHATSAPP_ACCESS_TOKEN en Secret Manager vía Firebase CLI.
 *
 * Uso:
 *   npx tsx scripts/set-whatsapp-token.ts
 *
 * El script te pide que pegues el token. Lo guarda en un archivo temporal
 * y lo sube a Secret Manager (crea o actualiza).
 *
 * Requiere: firebase CLI instalado y logueado.
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as readline from "readline";

const SECRET_NAME = "whatsapp-access-token";

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log("\n--- Cargar token de WhatsApp en Secret Manager ---\n");
  console.log("1. Copiá el token desde Meta for Developers (WhatsApp → API Setup)");
  console.log("2. Pegalo abajo cuando te lo pida");
  console.log("3. Enter para guardar\n");

  const token = await new Promise<string>((resolve) => {
    rl.question("Pegá el token acá y presioná Enter: ", (answer) => {
      resolve(answer.trim());
      rl.close();
    });
  });

  if (!token || token.length < 50) {
    console.error("\nError: El token parece incompleto. Debe ser largo (100+ caracteres) y empezar con EAA...");
    process.exit(1);
  }

  if (!token.startsWith("EAA")) {
    console.error("\nError: El token de Meta debe empezar con EAA");
    process.exit(1);
  }

  const tmpFile = path.join(os.tmpdir(), `whatsapp-token-${Date.now()}.txt`);
  try {
    fs.writeFileSync(tmpFile, token, { encoding: "utf8" });
    console.log("\nGuardando en Secret Manager...");
    execSync(`firebase apphosting:secrets:set ${SECRET_NAME} --data-file "${tmpFile}"`, {
      stdio: "inherit",
    });
    console.log("\n✓ Token guardado correctamente.");
    console.log("\nPasos siguientes:");
    console.log("  1. firebase apphosting:secrets:grantaccess whatsapp-access-token --backend notificashub");
    console.log("  2. firebase apphosting:rollouts:create notificashub (elegir rama main)");
  } catch (e) {
    console.error("\nError al guardar:", e);
    process.exit(1);
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      /* ignore */
    }
  }
}

main();
