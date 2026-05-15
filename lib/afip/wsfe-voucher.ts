/** Tipos de comprobante WSFE (tabla estándar). */
export function cbteTipoDesdeLetra(letra: string): number {
  const L = letra.toUpperCase().slice(0, 1);
  if (L === "A") return 1;
  if (L === "B") return 6;
  if (L === "C") return 11;
  return 1;
}

/** Convierte código WSFE a letra para el cálculo de importes (A/B/C). */
export function letraDesdeCbteTipo(cbteTipo: number): "A" | "B" | "C" {
  if (cbteTipo === 6) return "B";
  if (cbteTipo === 11) return "C";
  return "A";
}

function yyyymmdd(d: Date): number {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return parseInt(`${y}${m}${day}`, 10);
}

/** Primer y último día del mes calendario de `fechaYMD` (UTC). */
export function periodoServicioYyyymmdd(fechaYMD: string): { desde: number; hasta: number } {
  const [ys, ms] = fechaYMD.split("-");
  const y = parseInt(ys, 10);
  const m = parseInt(ms, 10);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0));
  return { desde: yyyymmdd(first), hasta: yyyymmdd(last) };
}

/**
 * Payload simplificado para ElectronicBilling.createNextVoucher del SDK
 * (campos alineados al ejemplo oficial; validar con tu contador en cuenta y orden).
 */
export function armarDataCreateNextVoucher(opts: {
  ptoVta: number;
  /** Si `cbteTipo` está definido, tiene prioridad sobre `letraComprobante`. */
  cbteTipo?: number;
  letraComprobante: string;
  fechaYMD: string;
  cuitCompradorDigits: string;
  neto: number;
  iva: number;
  total: number;
  /** 2 = Servicios (mensualidad). */
  concepto?: 1 | 2 | 3;
}): Record<string, unknown> {
  const cbteTipo =
    opts.cbteTipo != null && [1, 6, 11].includes(opts.cbteTipo)
      ? opts.cbteTipo
      : cbteTipoDesdeLetra(opts.letraComprobante);
  const docNro = parseInt(opts.cuitCompradorDigits.replace(/\D/g, "").slice(0, 11), 10) || 0;
  const concepto = opts.concepto ?? 2;
  const { desde, hasta } = periodoServicioYyyymmdd(opts.fechaYMD);
  const cbteFch = parseInt(opts.fechaYMD.replace(/-/g, "").slice(0, 8), 10);

  const row: Record<string, unknown> = {
    PtoVta: opts.ptoVta,
    CbteTipo: cbteTipo,
    Concepto: concepto,
    DocTipo: 80,
    DocNro: docNro,
    CbteFch: cbteFch,
    ImpTotal: opts.total,
    ImpTotConc: 0,
    ImpNeto: opts.neto,
    ImpOpEx: 0,
    ImpIVA: opts.iva,
    ImpTrib: 0,
    MonId: "PES",
    MonCotiz: 1,
  };

  if (concepto === 2 || concepto === 3) {
    row.FchServDesde = desde;
    row.FchServHasta = hasta;
    row.FchVtoPago = cbteFch;
  }

  if (opts.iva > 0 && (cbteTipo === 1 || cbteTipo === 6)) {
    row.Iva = [{ Id: 5, BaseImp: opts.neto, Importe: opts.iva }];
  }

  return row;
}
