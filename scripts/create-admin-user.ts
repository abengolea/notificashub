/**
 * Crea un usuario admin en Firebase Auth con email y contraseña.
 * Le asigna custom claims { admin: true } para validar en las APIs.
 *
 * Uso (solo desde terminal, sin archivo JSON):
 *   1. gcloud auth application-default login
 *   2. npm run create-admin-user -- abengolea1@gmail.com froiuer8734w
 *
 * Alternativa con archivo JSON: GOOGLE_APPLICATION_CREDENTIALS=ruta/al/archivo.json
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import path from "node:path";
import { existsSync } from "node:fs";

const PROJECT_ID = "studio-3864746689-59018";

async function main() {
  const email = process.argv[2]?.trim();
  const password = process.argv[3]?.trim();

  if (!email || !password) {
    console.error("Uso: npm run create-admin-user -- <email> <password>");
    console.error("Ejemplo: npm run create-admin-user -- admin@example.com miPassword123");
    process.exit(1);
  }

  const credentialsPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ??
    path.join(process.cwd(), `${PROJECT_ID}-firebase-adminsdk-fbsvc-5cdc673866.json`);

  const hasCredentialsFile =
    (process.env.GOOGLE_APPLICATION_CREDENTIALS && existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) ||
    (!process.env.GOOGLE_APPLICATION_CREDENTIALS && existsSync(credentialsPath));

  if (getApps().length === 0) {
    if (hasCredentialsFile) {
      const pathToUse = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? credentialsPath;
      initializeApp({ credential: cert(pathToUse), projectId: PROJECT_ID });
    } else {
      // Usa Application Default Credentials (gcloud auth application-default login)
      console.log("Usando credenciales de gcloud (gcloud auth application-default login)...");
      initializeApp({ projectId: PROJECT_ID });
    }
  }

  const auth = getAuth();

  try {
    const userRecord = await auth.createUser({
      email,
      password,
      emailVerified: true,
    });
    console.log("[OK] Usuario creado:", userRecord.uid);
    console.log("    Email:", userRecord.email);

    await auth.setCustomUserClaims(userRecord.uid, { admin: true });
    console.log("[OK] Custom claims { admin: true } asignados");

    console.log("");
    console.log("Listo. Podés iniciar sesión en el dashboard con:");
    console.log("  Email:", email);
    console.log("  Contraseña: (la que ingresaste)");
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code === "auth/email-already-exists") {
      const existing = await auth.getUserByEmail(email);
      await auth.setCustomUserClaims(existing.uid, { admin: true });
      console.log("[OK] Usuario ya existía. Se asignaron custom claims { admin: true }");
      console.log("    UID:", existing.uid);
    } else {
      console.error("Error:", e.message ?? err);
      process.exit(1);
    }
  }
}

main();
