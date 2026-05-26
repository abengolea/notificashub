import type { NextConfig } from "next";
import path from "node:path";

const projectRoot = process.cwd();

const firebasePublicEnv = {
  NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
};

const nextConfig: NextConfig = {
  // Evita que Turbopack elija el directorio equivocado si hay otro package-lock en un directorio padre (p. ej. monorepo local o CI).
  turbopack: {
    root: projectRoot,
    // PostCSS/Tailwind resuelve "tailwindcss" desde el package.json del padre (mis-proyectos)
    // si existe; fuerza el paquete al node_modules del proyecto.
    resolveAlias: {
      tailwindcss: path.join(projectRoot, "node_modules", "tailwindcss"),
    },
  },
  env: {
    // Firebase Auth vive en el bundle cliente; App Hosting debe tener estos secretos disponibles en BUILD.
    ...firebasePublicEnv,
    // HeartLink: inyectados para que funcionen en producción (Firebase no pasa .env al Cloud Function)
    HEARTLINK_URL:
      process.env.HEARTLINK_URL ?? "https://heartlink--heartlink-f4ftq.us-central1.hosted.app",
    INTERNAL_SECRET:
      process.env.INTERNAL_SECRET ?? "heartlink_internal_2026",
  },
};

export default nextConfig;
