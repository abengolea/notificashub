import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // HeartLink: inyectados para que funcionen en producción (Firebase no pasa .env al Cloud Function)
    HEARTLINK_URL:
      process.env.HEARTLINK_URL ?? "https://heartlink--heartlink-f4ftq.us-central1.hosted.app",
    INTERNAL_SECRET:
      process.env.INTERNAL_SECRET ?? "heartlink_internal_2026",
  },
};

export default nextConfig;
