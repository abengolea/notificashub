import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { requireDashboard } from "@/lib/require-dashboard";
import { resolveAccountingEntity } from "@/lib/accounting/constants";
import { deduccionBodySchema } from "@/lib/accounting/schemas";

export async function GET(req: NextRequest) {
  const denied = await requireDashboard(req);
  if (denied) return denied;

  const searchParams = new URL(req.url).searchParams;
  const entity = resolveAccountingEntity(searchParams);
  const y = parseInt(searchParams.get("year") ?? "", 10);
  if (!Number.isFinite(y)) {
    return NextResponse.json({ error: "Query year requerido" }, { status: 400 });
  }

  try {
    const snap = await db
      .collection(entity.collections.deducciones)
      .where("year", "==", y)
      .limit(2000)
      .get();

    const items = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        year: Number(d.year) || y,
        categoria: d.categoria ?? "otro",
        descripcion: d.descripcion ?? "",
        importe: Number(d.importe) || 0,
        fecha: typeof d.fecha === "string" ? d.fecha : "",
        notes: d.notes ?? "",
      };
    });

    return NextResponse.json({ deducciones: items });
  } catch (e) {
    console.error("[accounting/deducciones GET]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireDashboard(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const entity = resolveAccountingEntity(
    new URL(req.url).searchParams,
    (body as { entity?: unknown }).entity
  );

  if (!entity.isIndividual) {
    return NextResponse.json(
      { error: "Las deducciones personales solo aplican a entidades individuales" },
      { status: 400 }
    );
  }

  const parsed = deduccionBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validación fallida", details: parsed.error.flatten() }, { status: 400 });
  }

  const row = parsed.data;
  try {
    const ref = await db.collection(entity.collections.deducciones).add({
      empresa: entity.empresa,
      year: row.year,
      categoria: row.categoria,
      descripcion: row.descripcion,
      importe: row.importe,
      fecha: row.fecha ?? null,
      notes: row.notes ?? null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (e) {
    console.error("[accounting/deducciones POST]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
