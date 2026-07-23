import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { ACCOUNTING_COLLECTIONS } from "@/lib/accounting/constants";
import { dateOnlyToUtcMidday } from "@/lib/accounting/dates";
import { BILLING_CLIENTS_COLLECTION, BILLING_DEFAULT_PUNTO_VENTA } from "@/lib/billing/constants";
import { loadAfipIntegrationEnv, type AfipIntegrationEnv } from "@/lib/afip/env";
import { getWsaaTaForWsfe } from "@/lib/afip/wsaa";
import {
  feCompConsultar,
  feCompUltimoAutorizado,
  feParamGetPtosVenta,
  type FeCompConsultado,
} from "@/lib/afip/wsfe";
import { letraDesdeCbteTipo } from "@/lib/afip/wsfe-voucher";
import { closeAfipTlsAgent } from "@/lib/afip/fetch-afip";
import { envTrimmedKey } from "@/lib/env-trim-key";

/** Tipos habituales FE (facturas / ND / NC A-B-C). */
export const SYNC_CBTE_TIPOS = [1, 2, 3, 6, 7, 8, 11, 12, 13] as const;

function afipSyncKey(cbteTipo: number, ptoVta: number, nro: number): string {
  return `E|${cbteTipo}|${String(ptoVta).padStart(4, "0")}|${nro}`;
}

function invoiceMatchKey(puntoVenta: string, numero: string, cbteTipo: number): string {
  const pv = String(puntoVenta).replace(/\D/g, "").replace(/^0+/, "") || "0";
  const nro = String(numero).replace(/\D/g, "").replace(/^0+/, "") || "0";
  return `${cbteTipo}|${pv}|${nro}`;
}

function inYearMonth(fechaIso: string | undefined, year: number, month: number): boolean {
  if (!fechaIso) return false;
  const [y, m] = fechaIso.split("-").map((x) => parseInt(x, 10));
  return y === year && m === month;
}

/** PV desde env / billing (fallback si AFIP no lista PV). */
export function resolvePuntosVentaFallback(env: AfipIntegrationEnv): number[] {
  const set = new Set<number>();
  if (env.ptoVtaDefault >= 1) set.add(env.ptoVtaDefault);
  const billing = parseInt(BILLING_DEFAULT_PUNTO_VENTA.replace(/\D/g, ""), 10);
  if (Number.isFinite(billing) && billing >= 1) set.add(billing);
  const multi = envTrimmedKey("AFIP_PTO_VTAS");
  if (multi) {
    for (const part of multi.split(/[,;\s]+/)) {
      const n = parseInt(part.replace(/\D/g, ""), 10);
      if (Number.isFinite(n) && n >= 1 && n <= 99999) set.add(n);
    }
  }
  if (set.size === 0) set.add(2);
  return [...set].sort((a, b) => a - b);
}

async function loadClientNamesByCuit(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const snap = await db.collection(BILLING_CLIENTS_COLLECTION).limit(300).get();
    for (const d of snap.docs) {
      const data = d.data();
      const cuit = String(data.cuit ?? "").replace(/\D/g, "");
      const rs = String(data.razonSocial ?? "").trim();
      if (cuit && rs) map.set(cuit, rs);
    }
  } catch {
    /* ignore */
  }
  return map;
}

async function loadExistingVentaKeys(
  year: number,
  month: number
): Promise<{ afipKeys: Set<string>; matchKeys: Set<string> }> {
  const start = Timestamp.fromDate(new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)));
  const end = Timestamp.fromDate(new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)));
  const afipKeys = new Set<string>();
  const matchKeys = new Set<string>();

  const snap = await db
    .collection(ACCOUNTING_COLLECTIONS.facturas)
    .where("fecha", ">=", start)
    .where("fecha", "<=", end)
    .limit(2000)
    .get();

  for (const d of snap.docs) {
    const data = d.data();
    if (String(data.tipo) !== "venta") continue;
    if (typeof data.afipSyncKey === "string") afipKeys.add(data.afipSyncKey);
    const pv = String(data.puntoVenta ?? "");
    const nro = String(data.numero ?? "");
    const tc = String(data.tipoComprobante ?? "").toLowerCase();
    let cbte = 1;
    if (tc.includes("credito_b") || tc === "8") cbte = 8;
    else if (tc.includes("credito_c") || tc === "13") cbte = 13;
    else if (tc.includes("credito") || tc === "3") cbte = 3;
    else if (tc === "b" || tc.startsWith("6")) cbte = 6;
    else if (tc === "c" || tc.startsWith("11")) cbte = 11;
    else if (tc === "a" || tc.startsWith("1")) cbte = 1;
    matchKeys.add(invoiceMatchKey(pv, nro, cbte));
    if (tc === "b") matchKeys.add(invoiceMatchKey(pv, nro, 7));
    if (tc === "a") matchKeys.add(invoiceMatchKey(pv, nro, 2));
  }
  return { afipKeys, matchKeys };
}

export type SyncVentasResult = {
  consulted: number;
  imported: number;
  skippedDuplicates: number;
  skippedOutOfPeriod: number;
  skippedNoFecha: number;
  skippedConsultError: number;
  errors: string[];
  period: string;
  ptoVtas: number[];
  diagnostics: string[];
};

/**
 * Baja ventas emitidas del mes vía WSFE (solo factura electrónica / CAE de ese web service).
 * No incluye controladores fiscales ni otros canales: esos van por Mis Comprobantes Emitidos.
 */
export async function syncVentasWsfePeriod(input: {
  year: number;
  month: number;
  maxPerTipo?: number;
}): Promise<SyncVentasResult> {
  const maxPerTipo = input.maxPerTipo ?? 80;
  const period = `${input.year}-${String(input.month).padStart(2, "0")}`;
  const env = loadAfipIntegrationEnv();
  if ("error" in env) {
    return {
      consulted: 0,
      imported: 0,
      skippedDuplicates: 0,
      skippedOutOfPeriod: 0,
      skippedNoFecha: 0,
      skippedConsultError: 0,
      errors: [env.error],
      period,
      ptoVtas: [],
      diagnostics: [],
    };
  }

  const result: SyncVentasResult = {
    consulted: 0,
    imported: 0,
    skippedDuplicates: 0,
    skippedOutOfPeriod: 0,
    skippedNoFecha: 0,
    skippedConsultError: 0,
    errors: [],
    period,
    ptoVtas: [],
    diagnostics: [],
  };

  const clients = await loadClientNamesByCuit();
  const periodStart = `${period}-01`;
  const existing = await loadExistingVentaKeys(input.year, input.month);

  result.diagnostics.push(
    `Entorno AFIP: ${env.production ? "producción" : "homologación"} · CUIT ${env.cuit}`
  );
  result.diagnostics.push(
    "WSFE solo ve Factura Electrónica (CAE). Otros canales → Mis Comprobantes Emitidos (CSV)."
  );

  try {
    const ta = await getWsaaTaForWsfe(env);

    const ptos = await feParamGetPtosVenta(env, ta);
    if (ptos.ok && ptos.data.length) {
      const activos = ptos.data.filter((p) => !p.bloqueado && !p.fchBaja);
      result.ptoVtas = [...new Set(activos.map((p) => p.nro))].sort((a, b) => a - b);
      result.diagnostics.push(
        `PV ARCA/WSFE: ${activos.map((p) => `${p.nro}(${p.emisionTipo || "?"})`).join(", ")}`
      );
    } else {
      result.ptoVtas = resolvePuntosVentaFallback(env);
      result.diagnostics.push(
        `No se listaron PV desde AFIP; fallback ${result.ptoVtas.join(", ")}` +
          (ptos.ok ? "" : `: ${ptos.errors.map((e) => e.msg).join("; ")}`)
      );
    }

    for (const extra of resolvePuntosVentaFallback(env)) {
      if (!result.ptoVtas.includes(extra)) result.ptoVtas.push(extra);
    }
    result.ptoVtas.sort((a, b) => a - b);

    const pending: FeCompConsultado[] = [];

    for (const ptoVta of result.ptoVtas) {
      for (const cbteTipo of SYNC_CBTE_TIPOS) {
        const ult = await feCompUltimoAutorizado(env, ta, ptoVta, cbteTipo);
        if (!ult.ok) continue;
        const lastNro = ult.data.cbteNro;
        if (!lastNro || lastNro < 1) continue;

        let nro = lastNro;
        let scanned = 0;
        let reportedEarly = false;
        while (nro > 0 && scanned < maxPerTipo) {
          const cons = await feCompConsultar(env, ta, ptoVta, cbteTipo, nro);
          result.consulted += 1;
          scanned += 1;
          if (!cons.ok) {
            result.skippedConsultError += 1;
            if (result.errors.length < 5) {
              const msg =
                cons.errors.map((e) => e.msg).join("; ") ||
                cons.rawHint?.slice(0, 120) ||
                "consulta fallida";
              result.errors.push(`PV${ptoVta} tipo${cbteTipo} #${nro}: ${msg}`);
            }
            nro -= 1;
            continue;
          }
          const v = cons.data;
          if (!v.fechaIso) {
            result.skippedNoFecha += 1;
            nro -= 1;
            continue;
          }
          if (v.fechaIso < periodStart) {
            if (!reportedEarly) {
              result.diagnostics.push(
                `PV ${ptoVta} tipo ${cbteTipo}: último #${lastNro} del ${v.fechaIso} (anterior a ${period}) → sin movimientos en el mes`
              );
              reportedEarly = true;
            }
            break;
          }
          if (inYearMonth(v.fechaIso, input.year, input.month)) {
            pending.push(v);
            if (scanned === 1) {
              result.diagnostics.push(
                `PV ${ptoVta} tipo ${cbteTipo}: último #${lastNro} del ${v.fechaIso}`
              );
            }
          } else {
            result.skippedOutOfPeriod += 1;
          }
          nro -= 1;
        }
      }
    }

    if (pending.length === 0) {
      result.diagnostics.push(
        "Ninguna venta electrónica WSFE en el mes. Si la factura es de otro canal, subí Mis Comprobantes Emitidos."
      );
    }

    for (const v of pending) {
      const key = afipSyncKey(v.cbteTipo, v.ptoVta, v.voucherNumber);
      const match = invoiceMatchKey(String(v.ptoVta), String(v.voucherNumber), v.cbteTipo);
      if (existing.afipKeys.has(key) || existing.matchKeys.has(match)) {
        result.skippedDuplicates += 1;
        continue;
      }
      const letra = letraDesdeCbteTipo(v.cbteTipo);
      const isNc = [3, 8, 13].includes(v.cbteTipo);
      const tipoComprobante = isNc ? (`credito_${letra.toLowerCase()}` as const) : letra;
      const cuit = v.docNro ?? "";
      const razonsocial = (cuit && clients.get(cuit)) || (cuit ? `CUIT ${cuit}` : "Cliente AFIP");
      const neto = Math.abs(v.impNeto ?? 0);
      const iva = Math.abs(v.impIva ?? 0);
      const total = Math.abs(v.impTotal ?? neto + iva);
      const otros = Math.abs((v.impTrib ?? 0) + (v.impOpEx ?? 0) + (v.impTotConc ?? 0));

      try {
        await db.collection(ACCOUNTING_COLLECTIONS.facturas).add({
          empresa: "notificas_srl",
          tipo: "venta",
          numero: String(v.voucherNumber),
          puntoVenta: String(v.ptoVta).padStart(4, "0"),
          fecha: Timestamp.fromDate(dateOnlyToUtcMidday(v.fechaIso!)),
          razonsocial,
          cuit: cuit || null,
          tipoComprobante,
          netoGravado: neto,
          iva,
          otrosImpuestos: otros,
          total,
          observaciones: `CAE ${v.cae} · sync WSFE`,
          cae: v.cae,
          caeFchVto: v.caeFchVto || null,
          afipSyncKey: key,
          source: "afip_wsfe",
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        existing.afipKeys.add(key);
        existing.matchKeys.add(match);
        result.imported += 1;
      } catch (e) {
        result.errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  } finally {
    await closeAfipTlsAgent().catch(() => undefined);
  }

  return result;
}
