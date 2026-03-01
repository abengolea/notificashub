import { getApps, initializeApp, cert, type App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import path from "node:path";
import { existsSync } from "node:fs";

// Firebase Admin SDK - solo se ejecuta en el servidor (API routes, Server Components, etc.)
// Local: usa archivo de credenciales. Producción (Cloud Run): usa Application Default Credentials

const PROJECT_ID = "studio-3864746689-59018";

function getAdminApp(): App {
  const existingApps = getApps();
  if (existingApps.length > 0) {
    return existingApps[0] as App;
  }

  const credentialsPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ??
    path.join(process.cwd(), `${PROJECT_ID}-firebase-adminsdk-fbsvc-5cdc673866.json`);

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || existsSync(credentialsPath)) {
    return initializeApp({ credential: cert(credentialsPath) });
  }

  // Cloud Run / Firebase App Hosting: Application Default Credentials
  return initializeApp({ projectId: PROJECT_ID });
}

export const adminApp = getAdminApp();
export const db = getFirestore(adminApp);
