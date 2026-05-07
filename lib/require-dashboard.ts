import { NextRequest, NextResponse } from "next/server";
import { validateDashboardAccess } from "@/lib/auth-admin";

export async function requireDashboard(req: NextRequest): Promise<NextResponse | null> {
  const valid = await validateDashboardAccess(
    req.headers.get("authorization"),
    req.headers.get("x-dashboard-password")
  );
  if (!valid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
