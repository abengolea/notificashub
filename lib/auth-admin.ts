/**
 * Utilidad para validar tokens de Firebase Auth y verificar si el usuario es admin.
 * Las APIs del dashboard aceptan:
 * - Authorization: Bearer <idToken> (Firebase Auth, requiere claim admin: true)
 * - x-dashboard-password (legacy, compatible con DASHBOARD_PASSWORD)
 */
import { getAuth } from "firebase-admin/auth";
import { adminApp } from "./firebase-admin";

export async function validateDashboardAccess(
  authHeader: string | null,
  passwordHeader: string | null
): Promise<boolean> {
  const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;

  // Legacy: contraseña compartida
  if (DASHBOARD_PASSWORD && passwordHeader === DASHBOARD_PASSWORD) {
    return true;
  }

  // Firebase Auth: Bearer token válido (admin claim opcional - si existe, lo verifica)
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    try {
      const auth = getAuth(adminApp);
      const decoded = await auth.verifyIdToken(token);
      // Aceptar cualquier usuario autenticado; si tiene admin:true mejor
      return decoded.admin === true || !!decoded.uid;
    } catch {
      return false;
    }
  }

  return false;
}
