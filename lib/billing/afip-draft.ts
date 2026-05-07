import { BILLING_EMISOR } from "@/lib/billing/constants";

/** Códigos comunes `CbteTipo` (tabla AFIP). A=1, B=6, C=11. Verificar ante cambios normativos. */
const CBTE_TIPO_POR_LETRA: Record<string, number> = { A: 1, B: 6, C: 11 };

/** Alícuota 21 % gravado (Id 5 en tabla tipos de IVA WSFE — validar en documentación vigente). */
const IVA_21_ID = 5;

export type BorradorAfipInput = {
  fechaIsoYMD: string;
  puntoVentaPadded: string;
  numeroComprobante?: string;
  cliente: {
    razonSocial: string;
    cuit: string;
    tipoComprobanteDefault: string;
  };
  netoGravado: number;
  iva: number;
  total: number;
  tipoCambioUsdReferencia?: number;
  observaciones?: string;
};

/** Estructura orientativa para pegar en un integrador o contrastar con WSFE; no llama a AFIP. */
export function armarBorradorJsonAfip(input: BorradorAfipInput): Record<string, unknown> {
  const cuitRec = input.cliente.cuit.replace(/\D/g, "").slice(0, 11);
  const pvRaw = input.puntoVentaPadded.replace(/\D/g, "").replace(/^0+/, "") || "0";
  const ptoVta = Math.min(99999, Math.max(0, parseInt(pvRaw, 10) || 0));
  const letra = (input.cliente.tipoComprobanteDefault || "A").toUpperCase().slice(0, 1);
  const cbteTipo = CBTE_TIPO_POR_LETRA[letra] ?? 1;
  const fechaCbte = input.fechaIsoYMD.replace(/\D/g, "").slice(0, 8);

  const comprobante: Record<string, unknown> = {
    fechaCbte,
    ptoVta,
    cbteTipo,
    concepto: 2,
    docTipo: 80,
    docNro: Number(cuitRec) || 0,
    monId: "PES",
    monCotiz: 1,
    impNeto: input.netoGravado,
    impIVA: input.iva,
    impTotal: input.total,
    impTotConc: 0,
    impOpEx: 0,
    impTrib: 0,
  };

  if (input.numeroComprobante?.trim()) {
    const n = parseInt(input.numeroComprobante.replace(/^0+/, "") || "0", 10);
    if (n > 0) comprobante.cbteDesde = n;
    if (n > 0) comprobante.cbteHasta = n;
  }

  if ((letra === "A" || letra === "B") && input.iva > 0) {
    comprobante.iva = [
      {
        Id: IVA_21_ID,
        BaseImp: input.netoGravado,
        Importe: input.iva,
      },
    ];
  }

  const out: Record<string, unknown> = {
    _aviso:
      "BORRADOR ORIENTATIVO — Sin CAE / sin validez fiscal. Para comprobante electrónico válido hace falta WSAA + WSFE (o aplicativo ARCA) con certificado digital del contribuyente.",
    emisor: {
      razonSocial: BILLING_EMISOR.razonSocial,
      cuit: BILLING_EMISOR.cuit.replace(/\D/g, ""),
    },
    receptor: {
      razonSocial: input.cliente.razonSocial,
      cuit: cuitRec,
    },
    comprobante,
  };

  if (input.tipoCambioUsdReferencia != null && Number.isFinite(input.tipoCambioUsdReferencia)) {
    out.referenciaUsdContrato = {
      arsPorUsd: input.tipoCambioUsdReferencia,
      nota: "Solo referencia contractual; el comprobante se expresa en ARS.",
    };
  }

  if (input.observaciones?.trim()) {
    out.observacionesUsoInterno = input.observaciones.trim();
  }

  return out;
}
