import { NextRequest, NextResponse } from "next/server";

/**
 * Auth separada para la extensión de Chrome: token propio (EXTENSION_API_TOKEN),
 * distinto de DASHBOARD_PASSWORD / Firebase, y con alcance limitado a las rutas
 * bajo app/api/extension/*. Si se filtra, no da acceso al resto del dashboard.
 */
export async function requireExtension(req: NextRequest): Promise<NextResponse | null> {
  const token = process.env.EXTENSION_API_TOKEN?.trim();
  const header = req.headers.get("x-extension-token")?.trim();

  if (!token) {
    return NextResponse.json(
      { error: "EXTENSION_API_TOKEN no configurada en el servidor." },
      { status: 503 }
    );
  }
  if (!header || header !== token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
