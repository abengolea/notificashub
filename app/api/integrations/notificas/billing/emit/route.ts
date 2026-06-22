import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { db } from "@/lib/firebase-admin";
import { ACCOUNTING_COLLECTIONS } from "@/lib/accounting/constants";
import { dateOnlyToUtcMidday } from "@/lib/accounting/dates";
import { envTrimmedKey } from "@/lib/env-trim-key";
import { loadAfipIntegrationEnv } from "@/lib/afip/env";
import { getWsaaTaForWsfe } from "@/lib/afip/wsaa";
import { feCompUltimoAutorizado, feCAESolicitar } from "@/lib/afip/wsfe";
import { armarDataCreateNextVoucher, cbteTipoDesdeLetra } from "@/lib/afip/wsfe-voucher";
import { getAfipPtoVtaDefaultFromEnv } from "@/lib/afip/issuer-env";
import {
  ensureCobroForMpFactura,
  formatFacturaVentaLabel,
  observacionesCobroMpFactura,
} from "@/lib/accounting/cobro-mp";
import { toIso } from "@/lib/accounting/serialize";

export const runtime = "nodejs";

const REQUESTS_COLLECTION = "billing_notificas_invoice_requests";
const IVA_21 = 0.21;

const emitBodySchema = z
  .object({
    idempotencyKey: z.string().min(1).max(180).optional(),
    paymentId: z.coerce.string().min(1).max(80),
    transactionId: z.string().max(160).optional(),
    preferenceId: z.string().max(160).optional(),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    amount: z.coerce.number().finite().positive(),
    amountIncludesVat: z.boolean().optional().default(true),
    cbteTipo: z.enum(["A", "B", "C"]).optional(),
    ptoVta: z.coerce.number().int().min(1).max(99999).optional(),
    buyer: z.object({
      email: z.string().email().optional(),
      razonSocial: z.string().max(256).optional(),
      cuit: z.string().max(32).optional(),
      dni: z.string().max(32).optional(),
      ivaCondicion: z.string().max(64).optional(),
      domicilio: z.string().max(512).optional(),
    }),
    item: z.object({
      planId: z.string().max(128).optional(),
      planName: z.string().max(256).optional(),
      credits: z.coerce.number().int().positive().optional(),
      description: z.string().max(512).optional(),
    }),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((body) => body.idempotencyKey || body.paymentId, {
    message: "idempotencyKey o paymentId es requerido",
  });

type EmitBody = z.infer<typeof emitBodySchema>;

function sharedSecret(): string | undefined {
  return envTrimmedKey("NOTIFICAS_BILLING_SHARED_SECRET") || envTrimmedKey("INTERNAL_SECRET");
}

function bearerToken(req: NextRequest): string {
  const auth = req.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return req.headers.get("x-notificas-billing-secret")?.trim() ?? "";
}

function safeDocId(raw: string): string {
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 180);
  return cleaned || `req_${Date.now()}`;
}

function todayYmdArgentina(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function resolveTipoComprobante(body: EmitBody, hasCuit: boolean): "A" | "B" | "C" {
  if (body.cbteTipo === "C") return "C";
  if (body.cbteTipo === "A") {
    if (!hasCuit) {
      throw new Error("Factura A requiere CUIT comprador válido.");
    }
    return "A";
  }
  if (body.cbteTipo === "B") return "B";

  const iva = body.buyer.ivaCondicion?.toLowerCase() ?? "";
  if (hasCuit && iva.includes("responsable")) return "A";
  return "B";
}

function montosDesdeTotalCobrado(totalCobrado: number, tipo: "A" | "B" | "C", amountIncludesVat: boolean) {
  if (tipo === "C") {
    const total = round2(totalCobrado);
    return { netoGravado: total, iva: 0, total };
  }

  if (!amountIncludesVat && tipo === "A") {
    const netoGravado = round2(totalCobrado);
    const iva = round2(netoGravado * IVA_21);
    return { netoGravado, iva, total: round2(netoGravado + iva) };
  }

  const total = round2(totalCobrado);
  const netoGravado = round2(total / (1 + IVA_21));
  const iva = round2(total - netoGravado);
  return { netoGravado, iva, total };
}

function compradorDocumento(body: EmitBody): { docTipo: number; docNro: number; cuitDigits: string } {
  const cuitDigits = body.buyer.cuit?.replace(/\D/g, "").slice(0, 11) ?? "";
  if (cuitDigits.length === 11) {
    return { docTipo: 80, docNro: Number(cuitDigits), cuitDigits };
  }

  const dniDigits = body.buyer.dni?.replace(/\D/g, "").slice(0, 8) ?? "";
  if (dniDigits.length >= 6) {
    return { docTipo: 96, docNro: Number(dniDigits), cuitDigits: "" };
  }

  return { docTipo: 99, docNro: 0, cuitDigits: "" };
}

function sourceSystemFromBody(body: EmitBody): string {
  const sourceApp = typeof body.metadata?.source_app === "string" ? body.metadata.source_app.trim() : "";
  return sourceApp === "legalmev" ? "legalmev" : "notificas";
}

async function reserveRequest(requestId: string) {
  const ref = db.collection(REQUESTS_COLLECTION).doc(requestId);
  const now = Date.now();
  const staleBefore = now - 10 * 60 * 1000;

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      tx.set(ref, {
        status: "processing",
        attempts: 1,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { action: "process" as const, ref };
    }

    const data = snap.data() ?? {};
    if (data.status === "completed") {
      return {
        action: "completed" as const,
        ref,
        facturaId: typeof data.facturaId === "string" ? data.facturaId : undefined,
      };
    }

    const updatedAtMs =
      typeof data.updatedAt?.toMillis === "function" ? data.updatedAt.toMillis() : 0;
    if (data.status === "processing" && updatedAtMs > staleBefore) {
      return { action: "processing" as const, ref };
    }

    tx.update(ref, {
      status: "processing",
      attempts: FieldValue.increment(1),
      lastError: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { action: "process" as const, ref };
  });
}

export async function POST(req: NextRequest) {
  const secret = sharedSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "Falta NOTIFICAS_BILLING_SHARED_SECRET en el servidor Hub." },
      { status: 503 },
    );
  }
  if (bearerToken(req) !== secret) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: EmitBody;
  try {
    body = emitBodySchema.parse(await req.json());
  } catch (e) {
    const details = e instanceof z.ZodError ? e.flatten() : undefined;
    return NextResponse.json({ error: "Validación fallida", details }, { status: 400 });
  }

  const requestId = safeDocId(body.idempotencyKey ?? `mp_${body.paymentId}`);
  const reservation = await reserveRequest(requestId);

  if (reservation.action === "completed") {
    const facturaSnap = reservation.facturaId
      ? await db.collection(ACCOUNTING_COLLECTIONS.facturas).doc(reservation.facturaId).get()
      : null;
    const factura = facturaSnap?.exists ? facturaSnap.data() : undefined;
    let cobroId: string | undefined;
    let cobroCreated = false;
    if (reservation.facturaId && factura) {
      const facturaLabel = formatFacturaVentaLabel({
        tipoComprobante: String(factura.tipoComprobante ?? "B"),
        puntoVenta: String(factura.puntoVenta ?? ""),
        numero: String(factura.numero ?? ""),
      });
      const sourceSystem = String(factura.sourceSystem ?? sourceSystemFromBody(body));
      const sourceLabel =
        sourceSystem === "legalmev" ? "LegalMev" : sourceSystem === "notificas" ? "Notificas" : undefined;
      const fechaYmd =
        (factura.fecha ? toIso(factura.fecha)?.slice(0, 10) : null) ?? body.fecha ?? todayYmdArgentina();
      const ensured = await ensureCobroForMpFactura(db, {
        mercadopagoPaymentId: String(body.paymentId),
        facturaId: reservation.facturaId,
        fechaYmd,
        importe: Number(factura.total) || body.amount,
        concepto:
          body.item.description?.trim() ||
          body.item.planName?.trim() ||
          (body.item.credits ? `Compra de ${body.item.credits} envíos Notificas` : "Compra Notificas"),
        medio: "tarjeta",
        observaciones: observacionesCobroMpFactura({
          facturaLabel,
          mercadopagoPaymentId: String(body.paymentId),
          sourceLabel,
        }),
      });
      cobroId = ensured.cobroId;
      cobroCreated = ensured.created;
    }
    return NextResponse.json({
      ok: true,
      alreadyIssued: true,
      facturaId: reservation.facturaId,
      cobroId,
      cobroCreated,
      CAE: factura?.cae ?? null,
      CAEFchVto: factura?.caeFchVto ?? null,
      voucherNumber:
        typeof factura?.numero === "string" ? Number(factura.numero.replace(/\D/g, "")) : null,
      ptoVta:
        typeof factura?.puntoVenta === "string" ? Number(factura.puntoVenta.replace(/\D/g, "")) : null,
      cbteTipo: typeof factura?.cbteTipo === "number" ? factura.cbteTipo : null,
      tipoComprobante: factura?.tipoComprobante ?? null,
      netoGravado: factura?.netoGravado ?? null,
      iva: factura?.iva ?? null,
      total: factura?.total ?? null,
    });
  }
  if (reservation.action === "processing") {
    return NextResponse.json(
      { ok: false, status: "processing", message: "La emisión ya está en proceso." },
      { status: 202 },
    );
  }

  const fecha = body.fecha ?? todayYmdArgentina();
  const ptoVta = body.ptoVta ?? getAfipPtoVtaDefaultFromEnv();
  if (!ptoVta) {
    await reservation.ref.update({
      status: "failed",
      lastError: "Falta AFIP_PTO_VTA",
      updatedAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ error: "Falta AFIP_PTO_VTA en el servidor Hub." }, { status: 503 });
  }

  const env = loadAfipIntegrationEnv();
  if ("error" in env) {
    await reservation.ref.update({
      status: "failed",
      lastError: env.error,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ error: env.error }, { status: 503 });
  }

  for (const warning of env.warnings) {
    console.warn("[integrations/notificas/billing/emit]", warning);
  }

  try {
    const doc = compradorDocumento(body);
    const tipo = resolveTipoComprobante(body, doc.cuitDigits.length === 11);
    const montos = montosDesdeTotalCobrado(body.amount, tipo, body.amountIncludesVat);
    const cbteTipo = cbteTipoDesdeLetra(tipo);

    const voucherData = armarDataCreateNextVoucher({
      ptoVta,
      cbteTipo,
      letraComprobante: tipo,
      fechaYMD: fecha,
      cuitCompradorDigits: doc.cuitDigits || "0",
      neto: montos.netoGravado,
      iva: montos.iva,
      total: montos.total,
      concepto: 2,
    });
    voucherData.DocTipo = doc.docTipo;
    voucherData.DocNro = doc.docNro;

    const ta = await getWsaaTaForWsfe(env);
    const ultimo = await feCompUltimoAutorizado(env, ta, ptoVta, cbteTipo);
    if (!ultimo.ok) {
      throw new Error(`Error consultando último comprobante: ${ultimo.errors.map((x) => `[${x.code}] ${x.msg}`).join("; ")}`);
    }

    const cae = await feCAESolicitar(env, ta, ultimo.data.cbteNro + 1, voucherData);
    if (!cae.ok) {
      throw new Error(`Error solicitando CAE: ${cae.errors.map((x) => `[${x.code}] ${x.msg}`).join("; ")}`);
    }

    const facturaId = requestId;
    const facturaRef = db.collection(ACCOUNTING_COLLECTIONS.facturas).doc(facturaId);
    const razonSocial =
      body.buyer.razonSocial?.trim() ||
      body.buyer.email?.trim() ||
      (doc.docTipo === 99 ? "Consumidor final" : "Cliente Notificas");
    const concepto =
      body.item.description?.trim() ||
      body.item.planName?.trim() ||
      (body.item.credits ? `Compra de ${body.item.credits} envíos Notificas` : "Compra Notificas");

    const sourceApp =
      typeof body.metadata?.source_app === "string" ? body.metadata.source_app.trim() : "";
    const sourceLabel =
      sourceApp === "legalmev" ? "LegalMev" : sourceApp === "notificas" ? "Notificas" : "Notificas";
    const sourceSystem = sourceApp === "legalmev" ? "legalmev" : "notificas";

    const batch = db.batch();
    batch.set(facturaRef, {
      empresa: "notificas_srl",
      tipo: "venta",
      numero: String(cae.data.voucherNumber).padStart(8, "0"),
      puntoVenta: String(ptoVta).padStart(5, "0"),
      fecha: Timestamp.fromDate(dateOnlyToUtcMidday(fecha)),
      razonsocial: razonSocial,
      cuit: doc.cuitDigits || null,
      domicilio: body.buyer.domicilio?.trim() || null,
      email: body.buyer.email?.trim().toLowerCase() || null,
      tipoComprobante: tipo,
      cbteTipo,
      netoGravado: montos.netoGravado,
      iva: montos.iva,
      otrosImpuestos: 0,
      total: montos.total,
      cae: cae.data.cae,
      caeFchVto: cae.data.caeFchVto,
      observaciones: `${concepto}\nOrigen: ${sourceLabel} · paymentId ${body.paymentId}`,
      sourceSystem,
      sourcePaymentId: body.paymentId,
      sourceTransactionId: body.transactionId ?? null,
      sourcePreferenceId: body.preferenceId ?? null,
      sourceMetadata: body.metadata ?? null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    batch.update(reservation.ref, {
      status: "completed",
      facturaId,
      paymentId: body.paymentId,
      transactionId: body.transactionId ?? null,
      cae: cae.data.cae,
      voucherNumber: cae.data.voucherNumber,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    const facturaLabel = formatFacturaVentaLabel({
      tipoComprobante: tipo,
      puntoVenta: String(ptoVta).padStart(5, "0"),
      numero: String(cae.data.voucherNumber).padStart(8, "0"),
    });
    const ensured = await ensureCobroForMpFactura(db, {
      mercadopagoPaymentId: String(body.paymentId),
      facturaId,
      fechaYmd: fecha,
      importe: montos.total,
      concepto: `${concepto} · ${razonSocial}`.slice(0, 512),
      medio: "tarjeta",
      observaciones: observacionesCobroMpFactura({
        facturaLabel,
        mercadopagoPaymentId: String(body.paymentId),
        sourceLabel,
      }),
    });

    return NextResponse.json({
      ok: true,
      alreadyIssued: false,
      facturaId,
      cobroId: ensured.cobroId,
      cobroCreated: ensured.created,
      CAE: cae.data.cae,
      CAEFchVto: cae.data.caeFchVto,
      voucherNumber: cae.data.voucherNumber,
      ptoVta,
      cbteTipo,
      tipoComprobante: tipo,
      netoGravado: montos.netoGravado,
      iva: montos.iva,
      total: montos.total,
      environment: env.production ? "production" : "homologacion",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[integrations/notificas/billing/emit]", msg, e);
    await reservation.ref.update({
      status: "failed",
      lastError: msg,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
