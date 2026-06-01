/**
 * Diagnóstico IVA Compras contra Firestore (sin auth dashboard).
 * Uso: npx tsx scripts/audit-iva-period.ts 2026 5
 */
import { Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { ACCOUNTING_COLLECTIONS } from "@/lib/accounting/constants";
import { buildIvaAuditReport } from "@/lib/accounting/iva-audit";

async function main() {
  const y = parseInt(process.argv[2] ?? "2026", 10);
  const m = parseInt(process.argv[3] ?? "5", 10);
  const startD = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
  const endD = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
  const start = Timestamp.fromDate(startD);
  const end = Timestamp.fromDate(endD);

  const snap = await db
    .collection(ACCOUNTING_COLLECTIONS.pagos)
    .where("fecha", ">=", start)
    .where("fecha", "<=", end)
    .get();

  console.log(`\n=== AUDITORÍA IVA COMPRAS ${y}-${String(m).padStart(2, "0")} ===\n`);
  console.log(`Documentos Firestore (query por fecha pago): ${snap.size}\n`);

  const report = buildIvaAuditReport(
    snap.docs.map((d) => ({ id: d.id, data: () => d.data() })),
    y,
    m
  );

  console.log("RESUMEN:");
  console.log(JSON.stringify(report.resumen, null, 2));
  console.log("\n--- DIAGNÓSTICO POR GASTO ---\n");
  console.log(report.lineasTexto.join("\n"));

  for (const doc of snap.docs) {
    const d = doc.data();
    console.log("\nRAW Firestore", doc.id, {
      invoiceType: d.invoiceType ?? null,
      isVatComputable: d.isVatComputable ?? false,
      netTaxedAmount: d.netTaxedAmount ?? 0,
      vat21Amount: d.vat21Amount ?? 0,
      supplierCuit: d.supplierCuit ?? null,
      posNumber: d.posNumber ?? null,
      invoiceNumber: d.invoiceNumber ?? null,
      observaciones: String(d.observaciones ?? "").slice(0, 80),
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
