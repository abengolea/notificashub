import { getApps, initializeApp, cert, type App } from "firebase-admin/app";
import path from "node:path";

// Firebase Admin SDK - solo se ejecuta en el servidor (API routes, Server Components, etc.)
// Usa el archivo de credenciales: studio-3864746689-59018-firebase-adminsdk-fbsvc-5cdc673866.json

function getAdminApp(): App {
  const existingApps = getApps();
  if (existingApps.length > 0) {
    return existingApps[0] as App;
  }

  const credentialsPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ??
    path.join(
      process.cwd(),
      "studio-3864746689-59018-firebase-adminsdk-fbsvc-5cdc673866.json"
    );

  return initializeApp({
    credential: cert(credentialsPath),
  });
}

export const adminApp = getAdminApp();
