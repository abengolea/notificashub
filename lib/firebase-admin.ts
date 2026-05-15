import path from "node:path";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/** App Admin nombrada: Firestore de Notificas cuando Hub vive en otro proyecto Firebase. */
const NOTIFICAS_ADMIN_APP_NAME = "notificas-mail-webhook";

function getDefaultAppIfAny(): App | undefined {
  return getApps().find((a) => a.name === "[DEFAULT]");
}

/**
 * Firebase Admin por defecto (proyecto Hub o el que uses para el resto del servidor).
 * No uses `getApps()[0]`: se toma explícitamente la app `[DEFAULT]`.
 * Orden de `projectId` en la tripla env: NOTIFICASHUB_PROJECT_ID (Hub) > FIREBASE_PROJECT_ID > NEXT_PUBLIC_*.
 */
export function getAdminApp(): App {
  const existing = getDefaultAppIfAny();
  if (existing) return existing;

  const projectId =
    process.env.NOTIFICASHUB_PROJECT_ID?.trim() ??
    process.env.FIREBASE_PROJECT_ID ??
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (projectId && clientEmail && privateKey) {
    return initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, "\n"),
      }),
    });
  }

  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (credentialsPath) {
    return initializeApp({
      credential: cert(credentialsPath),
    });
  }

  const legacyPath = path.join(
    process.cwd(),
    "studio-3864746689-59018-firebase-adminsdk-fbsvc-330fe6860c.json"
  );
  console.warn(
    "[firebase-admin] Usando credencial legacy en disco (solo dev). " +
      "Configurá FIREBASE_* o GOOGLE_APPLICATION_CREDENTIALS."
  );
  return initializeApp({
    credential: cert(legacyPath),
  });
}

/**
 * Credenciales solo para `mail` / `whatsapp_ids` del proyecto Notificas.
 * Si no están definidas, el webhook usa el mismo Firestore que `getAdminApp()` (un solo proyecto).
 *
 * Orden:
 * 1. NOTIFICAS_FIREBASE_PROJECT_ID + NOTIFICAS_FIREBASE_CLIENT_EMAIL + NOTIFICAS_FIREBASE_PRIVATE_KEY
 * 2. NOTIFICAS_GOOGLE_APPLICATION_CREDENTIALS (ruta al JSON de la cuenta de servicio de Notificas)
 */
function getNotificasAdminApp(): App | undefined {
  const existing = getApps().find((a) => a.name === NOTIFICAS_ADMIN_APP_NAME);
  if (existing) return existing;

  const projectId = process.env.NOTIFICAS_FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.NOTIFICAS_FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.NOTIFICAS_FIREBASE_PRIVATE_KEY;
  const credentialsPath = process.env.NOTIFICAS_GOOGLE_APPLICATION_CREDENTIALS?.trim();

  if (projectId && clientEmail && privateKey) {
    return initializeApp(
      {
        credential: cert({
          projectId,
          clientEmail,
          privateKey: privateKey.replace(/\\n/g, "\n"),
        }),
      },
      NOTIFICAS_ADMIN_APP_NAME
    );
  }

  if (credentialsPath) {
    return initializeApp(
      {
        credential: cert(credentialsPath),
      },
      NOTIFICAS_ADMIN_APP_NAME
    );
  }

  return undefined;
}

/**
 * Firestore donde están `mail` y `whatsapp_ids` (Notificas).
 * Proyectos separados: definí NOTIFICAS_* o NOTIFICAS_GOOGLE_APPLICATION_CREDENTIALS.
 */
export function getFirestoreForWhatsappMail(): Firestore {
  const notificasApp = getNotificasAdminApp();
  if (notificasApp) {
    return getFirestore(notificasApp);
  }
  return getFirestore(getAdminApp());
}
