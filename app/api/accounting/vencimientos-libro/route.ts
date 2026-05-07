import { NextRequest, NextResponse } from "next/server";
import { requireDashboard } from "@/lib/require-dashboard";
import { ultimoDigitoCuitCuil, vencimientosLibroParaPanel } from "@/lib/arca-export/vencimientos";

/** Vencimientos orientativos Libro IVA Digital (tabla cargada año 2026; verificación en ARCA oficial). */
export async function GET(req: NextRequest) {
  const denied = await requireDashboard(req);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const cuit = searchParams.get("cuit");
  const last = searchParams.get("ultimoDigito");
  let ultimoDigito: number | null = null;
  if (last != null && last.trim() !== "") {
    ultimoDigito = parseInt(last.slice(-1), 10);
    if (!Number.isFinite(ultimoDigito)) ultimoDigito = null;
  } else if (cuit?.trim()) {
    ultimoDigito = ultimoDigitoCuitCuil(cuit);
  }

  const items = vencimientosLibroParaPanel(ultimoDigito, 8);

  return NextResponse.json({
    ultimoDigitoUsadoParaCalculo: ultimoDigito,
    items,
    avisoLegal:
      "Las fechas se calculan desde un calendario público cargado manualmente hasta 2026-11 como período. Antes de cualquier declaración verificá en https://www.afip.gob.ar/vencimientos/ o aplicativos ARCA; tu categorización impositiva puede cambiar obligaciones.",
  });
}
