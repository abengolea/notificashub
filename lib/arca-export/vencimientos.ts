import type { GrupoCuil } from "@/lib/arca-export/vencimientos-libro-iva-data";
import { LIBRO_IVA_VENCIMIENTOS } from "@/lib/arca-export/vencimientos-libro-iva-data";

export function grupoCuilFromUltimoDigito(digit: number): GrupoCuil {
  const d = ((digit % 10) + 10) % 10;
  if (d <= 1) return "01";
  if (d <= 3) return "23";
  if (d <= 5) return "45";
  if (d <= 7) return "67";
  return "89";
}

/** Último dígulo numérico del CUIT (sin guiones) */
export function ultimoDigitoCuitCuil(normalizedDigits: string): number | null {
  const only = normalizedDigits.replace(/\D/g, "");
  if (!only) return null;
  const last = parseInt(only.slice(-1), 10);
  return Number.isFinite(last) ? last : null;
}

export type VencimientoLibroConsulta = {
  periodo: { year: number; month: number; key: string };
  todasISO: string;
  grupoCuilISO: string;
  /** El más restrictivo cronológico: min(todas, grupo) cuando ambas aplican orientativamente. */
  fechaReferenciaOrientativaISO: string;
};

export function vencimientoLibroIvaOrientativo(
  year: number,
  month: number,
  ultimoDigitoCUIT: number
): VencimientoLibroConsulta | null {
  const key = `${year}-${String(month).padStart(2, "0")}`;
  const entry = LIBRO_IVA_VENCIMIENTOS[key];
  if (!entry) return null;
  const g = grupoCuilFromUltimoDigito(ultimoDigitoCUIT);
  const grupoISO = entry.gruposISO[g];
  const a = parseISODateOnly(entry.todasISO).getTime();
  const b = parseISODateOnly(grupoISO).getTime();
  const fechaRef = Math.min(a, b);
  const d = new Date(fechaRef);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return {
    periodo: { year, month, key },
    todasISO: entry.todasISO,
    grupoCuilISO: grupoISO,
    fechaReferenciaOrientativaISO: `${yyyy}-${mm}-${dd}`,
  };
}

function parseISODateOnly(iso: string): Date {
  const [y, m, da] = iso.split("-").map((x) => parseInt(x, 10));
  return new Date(Date.UTC(y, (m ?? 1) - 1, da ?? 1, 12, 0, 0));
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0));
}

export type VencimientoPanelItem = VencimientoLibroConsulta & {
  diasHastaOrientativo: number | null;
  alertaOrientativa: boolean;
};

/** Períodos calendario ya cerrados con vencimientos cargados para 2026. */
export function vencimientosLibroParaPanel(
  ultimoDigito: number | null,
  cantidadMesesPasadosAMostrar: number
): VencimientoPanelItem[] {
  const out: VencimientoPanelItem[] = [];
  const now = new Date();
  const cy = now.getUTCFullYear();
  const cm = now.getUTCMonth() + 1;
  const dig = ultimoDigito ?? 9;
  const today0 = startOfUtcDay(now);
  const tieneDigito = ultimoDigito != null && ultimoDigito >= 0;

  for (let i = 1; i <= cantidadMesesPasadosAMostrar; i++) {
    let m = cm - i;
    let y = cy;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    const v = vencimientoLibroIvaOrientativo(y, m, dig);
    if (!v) continue;
    const due = parseISODateOnly(v.fechaReferenciaOrientativaISO);
    const diasHasta = tieneDigito
      ? Math.round((due.getTime() - today0.getTime()) / 86400000)
      : null;
    let alerta = false;
    if (typeof diasHasta === "number") {
      alerta = diasHasta <= 14 || (diasHasta < 0 && diasHasta >= -21);
    }
    out.push({ ...v, diasHastaOrientativo: diasHasta, alertaOrientativa: tieneDigito && alerta });
  }
  return out;
}
