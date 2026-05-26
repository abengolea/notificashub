import type { NextConfig } from "next";
import path from "node:path";

const projectRoot = process.cwd();

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
    // HeartLink: inyectados para que funcionen en producción (Firebase no pasa .env al Cloud Function)
    HEARTLINK_URL:
      process.env.HEARTLINK_URL ?? "https://heartlink--heartlink-f4ftq.us-central1.hosted.app",
    INTERNAL_SECRET:
      process.env.INTERNAL_SECRET ?? "heartlink_internal_2026",
  },
};

export default nextConfig;
