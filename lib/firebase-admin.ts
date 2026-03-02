import { getApps, initializeApp, cert, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import path from "node:path";
import { existsSync } from "node:fs";

// Firebase Admin SDK - solo se ejecuta en el servidor (API routes, Server Components, etc.)
// Local: usa archivo de credenciales. Producción (Cloud Run): Application Default Credentials
// El Admin SDK omite las reglas de Firestore; gesAdmin y notificas-hub escriben sin restricciones.

const PROJECT_ID = "studio-3864746689-59018";

function getAdminApp(): App {
  const existingApps = getApps();
  if (existingApps.length > 0) {
    return existingApps[0] as App;
  }

  const credentialsPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ??
    path.join(process.cwd(), `${PROJECT_ID}-firebase-adminsdk-fbsvc-5cdc673866.json`);

  // Intentar credenciales de archivo; si falla, usar Application Default Credentials (deploy)
  try {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS || existsSync(credentialsPath)) {
      return initializeApp({ credential: cert(credentialsPath) });
    }
  } catch {
    // Archivo inválido o inaccesible durante build — usar ADC
  }

  // Cloud Run / Firebase App Hosting: Application Default Credentials
  return initializeApp({ projectId: PROJECT_ID });
}

export const adminApp = getAdminApp();
export const db: Firestore = getFirestore(adminApp);
