import { initializeApp, getApps, type FirebaseApp } from "firebase/app";

// Configuración de Firebase para Notificashub
// Variables en .env.local (Local), .env.staging (Staging), .env.production (Producción)
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Inicializar Firebase solo una vez (evita múltiples instancias)
function getFirebaseApp(): FirebaseApp {
  const existingApps = getApps();
  if (existingApps.length === 0) {
    return initializeApp(firebaseConfig);
  }
  return existingApps[0] as FirebaseApp;
}

export const app = getFirebaseApp();
