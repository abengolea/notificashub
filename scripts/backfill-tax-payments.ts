/**
 * Migra pagos existentes con accountingCategory === "impuestos":
 * - Infiere taxSubcategory e isIncomeTaxDeductible a partir del campo `concepto`
 *   usando la misma lógica de inferVepHint que usa el import bancario.
 * - Setea invoiceType = "vep" si aún no tiene tipo de comprobante.
 * - Setea supplierName / proveedor = "AFIP - ARCA" si está vacío.
 *
 * Uso:
 *   npm run backfill:tax-payments          (dry-run por defecto)
 *   npm run backfill:tax-payments -- --apply
 *
 * Credenciales: GOOGLE_APPLICATION_CREDENTIALS en .env.local o el JSON
 * studio-3864746689-59018-firebase-adminsdk-*.json en la raíz del repo.
 */
import "./load-local-env";
import { db } from "@/lib/firebase-admin";
import { ACCOUNTING_COLLECTIONS } from "@/lib/accounting/constants";
import { inferVepHint } from "@/lib/accounting/bank-extract";

const dryRun = !process.argv.includes("--apply");

async function main() {
  console.log(`\n=== backfill-tax-payments ${dryRun ? "[DRY RUN]" : "[APPLY]"} ===\n`);

  const snap = await db
    .collection(ACCOUNTING_COLLECTIONS.pagos)
    .where("accountingCategory", "==", "impuestos")
    .get();

  console.log(`Pagos con categoría "impuestos": ${snap.size}`);

  let updated = 0;
  let skipped = 0;
  let noHint = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const concepto: string = String(data.concepto ?? data.proveedor ?? "");
    const alreadyHasSubcat = !!data.taxSubcategory;

    if (alreadyHasSubcat) {
      skipped += 1;
      continue;
    }

    const hint = inferVepHint(concepto);

    if (!hint) {
      console.log(`  [sin hint] ${doc.id} · "${concepto.slice(0, 60)}"`);
      noHint += 1;
      continue;
    }

    const patch: Record<string, unknown> = {
      taxSubcategory: hint.taxSubcategory,
      isIncomeTaxDeductible: hint.isIncomeTaxDeductible,
    };
    if (!data.invoiceType) patch.invoiceType = "vep";
    if (!data.supplierName && !data.proveedor) {
      patch.supplierName = "AFIP - ARCA";
      patch.proveedor = "AFIP - ARCA";
    }

    console.log(
      `  [${dryRun ? "DRY" : "UPDATE"}] ${doc.id} · "${concepto.slice(0, 50)}" → ${hint.taxSubcategory} · deducible=${hint.isIncomeTaxDeductible}`
    );

    if (!dryRun) {
      await doc.ref.update(patch);
    }

    updated += 1;
  }

  console.log(`\nResultado:`);
  console.log(`  Actualizados: ${updated}`);
  console.log(`  Ya tenían taxSubcategory: ${skipped}`);
  console.log(`  Sin hint detectado: ${noHint}`);
  if (dryRun) {
    console.log(`\nEs un dry run. Corré con --apply para escribir en Firestore.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
