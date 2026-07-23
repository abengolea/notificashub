"use client";

import { useCallback, useEffect, useState } from "react";
import type { AccountingEntityId } from "@/lib/accounting/entities";
import { TabPageIntro } from "./contabilidad-shell";

type AuditGasto = {
  id: string;
  concepto: string;
  proveedor: string;
  totalAmount: number;
  status: string;
  motivos: string[];
  ivaPotencialPerdido: number;
  tienePdf: boolean;
  invoiceTypeStored: string | null;
  invoiceTypeEffective: string | null;
  isVatComputableStored: boolean;
  isVatComputableEffective: boolean;
  exportableAfterResolve: boolean;
  usedLegacyFallback: boolean;
  legacyInference?: { inferredFields: string[] };
};

type AuditReport = {
  periodo: { key: string };
  resumen: {
    totalGastosPeriodo: number;
    gastosConPdf: number;
    gastosFacturaAStored: number;
    gastosFacturaAEffective: number;
    gastosIvaComputableStored: number;
    gastosIvaComputableEffective: number;
    gastosExportados: number;
    gastosExcluidos: number;
    gastosInferidosPendientes: number;
    ivaCreditoPotencialPerdido: number;
    ivaCreditoExportable: number;
    facturasCompraExportadas: number;
  };
  gastos: AuditGasto[];
  diagnosticoTexto?: string;
  causaRaiz?: string;
};

function money(n: number): string {
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 });
}

function statusBadge(status: string) {
  const cls =
    status === "INCLUIDO"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
      : status === "INFERIDO_PENDIENTE_REVISION"
        ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
        : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200";
  return (
    <span className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full ${cls}`}>{status}</span>
  );
}

export function AuditoriaIvaTab(props: {
  authHeader: HeadersInit;
  year: string;
  month: string;
  qh: () => string;
  entityId: AccountingEntityId;
}) {
  const { authHeader, year, month, qh, entityId } = props;
  const [report, setReport] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounting/iva-audit?${qh()}`, { headers: authHeader });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(typeof j?.error === "string" ? j.error : `HTTP ${res.status}`);
        return;
      }
      setReport(await res.json());
    } finally {
      setLoading(false);
    }
  }, [authHeader, qh]);

  useEffect(() => {
    void load();
  }, [load]);

  const repair = async (opts: { applyInferred?: boolean; reprocessPdf?: boolean; pagoId?: string }) => {
    setRepairing(true);
    try {
      const res = await fetch("/api/accounting/iva-audit/repair", {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          year: parseInt(year, 10),
          month: parseInt(month, 10),
          entity: entityId,
          applyInferred: opts.applyInferred ?? true,
          reprocessPdf: opts.reprocessPdf ?? false,
          pagoId: opts.pagoId,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(typeof j?.error === "string" ? j.error : "Error en reparación");
        return;
      }
      alert(`Reparación completada: ${j.total ?? j.repaired?.length ?? 0} gasto(s) actualizado(s).`);
      await load();
    } finally {
      setRepairing(false);
    }
  };

  const r = report?.resumen;

  return (
    <div className="space-y-6">
      <TabPageIntro
        title="Auditoría IVA Compras"
        description="Mirás qué gastos entran (o no) al Libro IVA Compras al exportar en Declarar."
      />

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg border px-4 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
        >
          {loading ? "Analizando…" : "Actualizar diagnóstico"}
        </button>
        <button
          type="button"
          disabled={repairing}
          onClick={() => void repair({ applyInferred: true, reprocessPdf: false })}
          className="rounded-lg bg-violet-600 text-white px-4 py-2 text-sm hover:bg-violet-700 disabled:opacity-50"
        >
          Aplicar inferencia legacy (período)
        </button>
        <button
          type="button"
          disabled={repairing}
          onClick={() => void repair({ applyInferred: true, reprocessPdf: true })}
          className="rounded-lg bg-indigo-600 text-white px-4 py-2 text-sm hover:bg-indigo-700 disabled:opacity-50"
        >
          Re-OCR PDF + inferencia (período)
        </button>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {report?.causaRaiz ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-4 text-sm text-amber-950 dark:text-amber-100">
          <p className="font-semibold mb-1">Causa raíz detectada</p>
          <p>{report.causaRaiz}</p>
        </div>
      ) : null}

      {r ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            ["Gastos del período", r.totalGastosPeriodo],
            ["Con PDF", r.gastosConPdf],
            ["Factura A (guardado)", r.gastosFacturaAStored],
            ["Factura A (efectivo)", r.gastosFacturaAEffective],
            ["IVA computable (guardado)", r.gastosIvaComputableStored],
            ["IVA computable (efectivo)", r.gastosIvaComputableEffective],
            ["Exportables", r.gastosExportados],
            ["Excluidos", r.gastosExcluidos],
            ["IVA crédito exportable", money(r.ivaCreditoExportable)],
            ["IVA potencial perdido", money(r.ivaCreditoPotencialPerdido)],
          ].map(([label, val]) => (
            <div key={String(label)} className="rounded-xl bg-white dark:bg-zinc-800 border p-4 shadow-sm">
              <p className="text-xs text-zinc-500 uppercase tracking-wide">{label}</p>
              <p className="text-xl font-semibold mt-1">{val}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="rounded-xl bg-white dark:bg-zinc-800 border overflow-hidden shadow-sm">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="border-b bg-zinc-50 dark:bg-zinc-900/60">
              <th className="text-left py-3 px-3">Estado</th>
              <th className="text-left py-3 px-3">Concepto</th>
              <th className="text-left py-3 px-3">Proveedor</th>
              <th className="text-right py-3 px-3">Importe</th>
              <th className="text-right py-3 px-3">IVA perdido</th>
              <th className="text-left py-3 px-3">Motivos</th>
              <th className="text-left py-3 px-3"></th>
            </tr>
          </thead>
          <tbody>
            {!report?.gastos?.length ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-zinc-500">
                  {loading ? "Cargando…" : "Sin gastos en el período."}
                </td>
              </tr>
            ) : (
              report.gastos.map((g) => (
                <tr key={g.id} className="border-b border-zinc-100 dark:border-zinc-700/50 align-top">
                  <td className="py-2 px-3">{statusBadge(g.status)}</td>
                  <td className="py-2 px-3">
                    {g.concepto}
                    {g.tienePdf ? (
                      <span className="ml-1 text-[10px] text-violet-600 dark:text-violet-400">PDF</span>
                    ) : null}
                  </td>
                  <td className="py-2 px-3">{g.proveedor || "—"}</td>
                  <td className="py-2 px-3 text-right">{money(g.totalAmount)}</td>
                  <td className="py-2 px-3 text-right text-red-600 dark:text-red-400">
                    {g.ivaPotencialPerdido > 0 ? money(g.ivaPotencialPerdido) : "—"}
                  </td>
                  <td className="py-2 px-3 text-xs text-zinc-600 dark:text-zinc-400 max-w-xs">
                    <ul className="list-disc pl-4 space-y-0.5">
                      {g.motivos.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                    {g.usedLegacyFallback && g.legacyInference?.inferredFields?.length ? (
                      <p className="mt-1 text-violet-600 dark:text-violet-400">
                        Inferido: {g.legacyInference.inferredFields.join(", ")}
                      </p>
                    ) : null}
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    {!g.exportableAfterResolve && g.tienePdf ? (
                      <button
                        type="button"
                        className="text-indigo-600 hover:underline text-xs"
                        disabled={repairing}
                        onClick={() => void repair({ pagoId: g.id, applyInferred: true, reprocessPdf: true })}
                      >
                        Re-OCR
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <p className="text-xs text-zinc-500 p-4">Período: {qh()}</p>
      </div>

      {report?.diagnosticoTexto ? (
        <details className="rounded-xl border bg-zinc-50 dark:bg-zinc-900/40 p-4">
          <summary className="cursor-pointer font-medium text-sm">Reporte texto completo</summary>
          <pre className="mt-3 text-xs whitespace-pre-wrap font-mono overflow-x-auto">{report.diagnosticoTexto}</pre>
        </details>
      ) : null}
    </div>
  );
}
