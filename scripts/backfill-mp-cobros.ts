/**
 * Crea o vincula cobros para facturas venta emitidas desde Mercado Pago (sourcePaymentId).
 *
 * Uso:
 *   npm run backfill:mp-cobros
 *   npm run backfill:mp-cobros -- 2026 5
 *   npm run backfill:mp-cobros -- --dry-run
 *
 * Credenciales: GOOGLE_APPLICATION_CREDENTIALS en .env.local o el JSON
 * studio-3864746689-59018-firebase-adminsdk-*.json en la raíz del repo.
 */
import "./load-local-env";
import { db } from "@/lib/firebase-admin";
import { ACCOUNTING_COLLECTIONS } from "@/lib/accounting/constants";
import {
  cobroInputFromFacturaVentaMp,
  ensureCobroForMpFactura,
  formatFacturaVentaLabel,
} from "@/lib/accounting/cobro-mp";
import { toIso } from "@/lib/accounting/serialize";

function parseArgs(argv: string[]): { dryRun: boolean; year?: number; month?: number } {
  const args = argv.filter((a) => a !== "--dry-run");
  const dryRun = argv.includes("--dry-run");
  const y = args[2] ? parseInt(args[2], 10) : undefined;
  const m = args[3] ? parseInt(args[3], 10) : undefined;
  if (y != null && (!Number.isFinite(y) || !Number.isFinite(m!) || m! < 1 || m! > 12)) {
    throw new Error("Período inválido. Uso: backfill-mp-cobros.ts [--dry-run] [year] [month]");
  }
  return { dryRun, year: y, month: m };
}

function facturaInPeriod(fecha: unknown, year: number, month: number): boolean {
  const iso = toIso(fecha);
  if (!iso) return false;
  const d = new Date(iso);
  return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month;
}

async function main() {
  const { dryRun, year, month } = parseArgs(process.argv);
  const periodLabel =
    year != null && month != null ? `${year}-${String(month).padStart(2, "0")}` : "todos los períodos";

  console.log(`\n=== BACKFILL COBROS MP · ${periodLabel}${dryRun ? " (dry-run)" : ""} ===\n`);

  const snap = await db.collection(ACCOUNTING_COLLECTIONS.facturas).where("tipo", "==", "venta").get();

  let scanned = 0;
  let skippedNoMp = 0;
  let skippedPeriod = 0;
  let alreadyOk = 0;
  let created = 0;
  let linked = 0;
  const errors: string[] = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const paymentId = String(data.sourcePaymentId ?? "").trim();
    if (!paymentId) {
      skippedNoMp += 1;
      continue;
    }

    if (year != null && month != null && !facturaInPeriod(data.fecha, year, month)) {
      skippedPeriod += 1;
      continue;
    }

    scanned += 1;
    const input = cobroInputFromFacturaVentaMp({ id: doc.id, data });
    if (!input) {
      errors.push(`${doc.id}: no se pudo armar cobro (datos incompletos)`);
      continue;
    }

    const label = formatFacturaVentaLabel({
      tipoComprobante: String(data.tipoComprobante ?? "B"),
      puntoVenta: String(data.puntoVenta ?? ""),
      numero: String(data.numero ?? ""),
    });

    if (dryRun) {
      console.log(`[dry-run] ${label} · MP #${paymentId} · $${input.importe} · factura ${doc.id}`);
      continue;
    }

    try {
      const result = await ensureCobroForMpFactura(db, input);
      if (result.created) {
        created += 1;
        console.log(`+ cobro ${result.cobroId} · ${label} · MP #${paymentId}`);
      } else if (result.linkedFactura) {
        linked += 1;
        console.log(`↔ vinculado ${result.cobroId} · ${label} · MP #${paymentId}`);
      } else {
        alreadyOk += 1;
        console.log(`= ok ${result.cobroId} · ${label} · MP #${paymentId}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${doc.id} (MP ${paymentId}): ${msg}`);
    }
  }

  console.log("\n--- RESUMEN ---");
  console.log(`Facturas venta MP en scope: ${scanned}`);
  console.log(`Cobros creados: ${created}`);
  console.log(`Cobros vinculados (facturaId): ${linked}`);
  console.log(`Ya existían completos: ${alreadyOk}`);
  console.log(`Sin sourcePaymentId: ${skippedNoMp}`);
  if (year != null) console.log(`Fuera del período: ${skippedPeriod}`);
  if (errors.length) {
    console.log(`Errores: ${errors.length}`);
    for (const err of errors) console.log(`  · ${err}`);
  }
  console.log("");
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("Could not load the default credentials")) {
    console.error(
      "\nNo se encontraron credenciales Firebase Admin.\n" +
        "Opciones:\n" +
        "  1. Descomentar GOOGLE_APPLICATION_CREDENTIALS en .env.local apuntando al JSON\n" +
        "  2. Dejar el archivo studio-3864746689-59018-firebase-adminsdk-*.json en la raíz del repo\n"
    );
  }
  console.error(e);
  process.exit(1);
});
