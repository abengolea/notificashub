import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/firebase-admin";
import { requireDashboard } from "@/lib/require-dashboard";
import { envTrimmedKey } from "@/lib/env-trim-key";
import { BILLING_CLIENTS_COLLECTION } from "@/lib/billing/constants";
import { fetchCotizacionDolarReferencia } from "@/lib/billing/exchange-rate";
import { montosDesdeUsdTipoCambio, roundArs2 } from "@/lib/billing/calc";
import { loadAfipIntegrationEnv } from "@/lib/afip/env";
import { getWsaaTaForWsfe } from "@/lib/afip/wsaa";
import { feCompUltimoAutorizado, feCAESolicitar } from "@/lib/afip/wsfe";
import { armarDataCreateNextVoucher, letraDesdeCbteTipo } from "@/lib/afip/wsfe-voucher";
import {
  getAfipCbteTipoFromEnv,
  getAfipPtoVtaDefaultFromEnv,
} from "@/lib/afip/issuer-env";

const bodySchema = z.object({
  clientId: z.string().min(1).max(128),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  arsPorUsdManual: z.number().finite().positive().optional(),
  /** Si omitís, usa `AFIP_PTO_VTA` del servidor. */
  ptoVta: z.coerce.number().int().min(1).max(99999).optional(),
  /**
   * Opcional: ID de contexto (ej. escuela Firebase). Si definís `AFIP_EMIT_SCHOOL_ID` en el servidor
   * y enviás este campo, deben coincidir (evita pegar CAE al tenant equivocado).
   */
  emitContextId: z.string().max(128).optional(),
});

/**
 * Solicita CAE vía WSAA + WSFEv1 nativo (OpenSSL + SOAP directo, sin relay externo).
 * Reemplaza el SDK @afipsdk/afip.js que requería AFIP_ACCESS_TOKEN.
 */
export async function POST(req: NextRequest) {
  const denied = await requireDashboard(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validación fallida", details: parsed.error.flatten() }, { status: 400 });
  }

  const { clientId, fecha, arsPorUsdManual, ptoVta: ptoVtaBody, emitContextId } = parsed.data;

  const schoolLock = envTrimmedKey("AFIP_EMIT_SCHOOL_ID");
  if (schoolLock && emitContextId?.trim() && emitContextId.trim() !== schoolLock) {
    return NextResponse.json(
      { error: "emitContextId no coincide con AFIP_EMIT_SCHOOL_ID del servidor" },
      { status: 403 },
    );
  }

  const ptoVta = ptoVtaBody ?? getAfipPtoVtaDefaultFromEnv();
  if (!ptoVta) {
    return NextResponse.json(
      { error: "Falta punto de venta: completalo en el panel o definí AFIP_PTO_VTA en el servidor (ej. 9)." },
      { status: 400 },
    );
  }

  const env = loadAfipIntegrationEnv();
  if ("error" in env) {
    return NextResponse.json({ error: env.error }, { status: 503 });
  }

  for (const w of env.warnings) {
    console.warn("[billing/afip/cae]", w);
  }

  try {
    const doc = await db.collection(BILLING_CLIENTS_COLLECTION).doc(clientId).get();
    if (!doc.exists) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }
    const c = doc.data()!;
    if (c.active === false) {
      return NextResponse.json({ error: "Cliente inactivo" }, { status: 400 });
    }

    let arsPorUsd = arsPorUsdManual;
    if (arsPorUsd == null) {
      const cot = await fetchCotizacionDolarReferencia();
      arsPorUsd = cot.venta;
    }

    const cbteTipoEnv = getAfipCbteTipoFromEnv();
    const tipoCliente = (c.tipoComprobanteDefault ?? "A") as "A" | "B" | "C";
    const tipoParaMontos =
      cbteTipoEnv != null ? letraDesdeCbteTipo(cbteTipoEnv) : tipoCliente;

    const usd = typeof c.mensualidadUsd === "number" ? c.mensualidadUsd : 150;
    const m = montosDesdeUsdTipoCambio(usd, arsPorUsd, tipoParaMontos);

    const cuitRec = String(c.cuit ?? "").replace(/\D/g, "").slice(0, 11);
    if (cuitRec.length < 10) {
      return NextResponse.json({ error: "CUIT del cliente inválido" }, { status: 400 });
    }

    const voucherData = armarDataCreateNextVoucher({
      ptoVta,
      cbteTipo: cbteTipoEnv,
      letraComprobante: tipoCliente,
      fechaYMD: fecha,
      cuitCompradorDigits: cuitRec,
      neto: roundArs2(m.netoGravado),
      iva: roundArs2(m.iva),
      total: roundArs2(m.total),
      concepto: 2,
    });

    const cbteTipo = voucherData.CbteTipo as number;

    // Obtener TA de WSAA (caché en AFIP_WORK_DIR si está vigente)
    const ta = await getWsaaTaForWsfe(env);

    // Obtener el último comprobante para calcular el próximo número
    const ultRes = await feCompUltimoAutorizado(env, ta, ptoVta, cbteTipo);
    if (!ultRes.ok) {
      const errMsg = ultRes.errors.map((e) => `[${e.code}] ${e.msg}`).join("; ");
      console.error("[billing/afip/cae] feCompUltimoAutorizado error:", errMsg);
      return NextResponse.json({ error: `Error consultando último comprobante: ${errMsg}` }, { status: 502 });
    }

    const nextVoucherNro = ultRes.data.cbteNro + 1;

    // Solicitar CAE
    const caeRes = await feCAESolicitar(env, ta, nextVoucherNro, voucherData);
    if (!caeRes.ok) {
      const errMsg = caeRes.errors.map((e) => `[${e.code}] ${e.msg}`).join("; ");
      console.error("[billing/afip/cae] feCAESolicitar error:", errMsg, caeRes.rawHint ?? "");
      return NextResponse.json({ error: `Error solicitando CAE: ${errMsg}` }, { status: 502 });
    }

    return NextResponse.json({
      CAE: caeRes.data.cae,
      CAEFchVto: caeRes.data.caeFchVto,
      voucherNumber: caeRes.data.voucherNumber,
      ptoVta,
      cbteTipo,
      cbteTipoSource: cbteTipoEnv != null ? "AFIP_CBTE_TIPO" : "cliente",
      arsPorUsdUsado: arsPorUsd,
      netoGravado: roundArs2(m.netoGravado),
      iva: roundArs2(m.iva),
      total: roundArs2(m.total),
      environment: env.production ? "production" : "homologación",
    });
  } catch (e: unknown) {
    console.error("[billing/afip/cae POST]", e);
    const msg = e instanceof Error ? e.message : "Error al solicitar CAE";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
