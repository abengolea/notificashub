"use client";

import type { Dispatch, ReactNode, SetStateAction } from "react";
import { CONTAB_TABS, type TabId } from "./contabilidad-tabs";

export { CONTAB_TABS, type TabId };

export function ContabTabBar(props: {
  tab: TabId;
  setTab: (t: TabId) => void;
  counts: Partial<Record<TabId, number>>;
}) {
  const { tab, setTab, counts } = props;
  const operacion = CONTAB_TABS.filter((t) => t.group === "operacion");
  const impuestos = CONTAB_TABS.filter((t) => t.group === "impuestos");

  const renderBtn = (t: (typeof CONTAB_TABS)[number]) => {
    const n = counts[t.id];
    const active = tab === t.id;
    return (
      <button
        key={t.id}
        type="button"
        onClick={() => setTab(t.id)}
        className={`shrink-0 rounded-lg px-3 py-2 text-left transition-colors min-w-[7.5rem] ${
          active
            ? "bg-emerald-600 text-white shadow-sm"
            : "bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 hover:border-emerald-500/40"
        }`}
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          {t.label}
          {n != null && n > 0 ? (
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                active ? "bg-white/20" : "bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300"
              }`}
            >
              {n}
            </span>
          ) : null}
        </span>
        <span className={`block text-[11px] mt-0.5 ${active ? "text-emerald-100" : "text-zinc-500"}`}>
          {t.hint}
        </span>
      </button>
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {operacion.map(renderBtn)}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 items-center">
        <span className="text-[10px] uppercase tracking-wide text-zinc-400 pr-1 shrink-0">Impuestos</span>
        {impuestos.map(renderBtn)}
      </div>
    </div>
  );
}

type VencRow = {
  periodo: { year: number; month: number; key: string };
  todasISO: string;
  grupoCuilISO: string;
  fechaReferenciaOrientativaISO: string;
  diasHastaOrientativo: number | null;
  alertaOrientativa: boolean;
};

export function ArcaTab(props: {
  month: string;
  year: string;
  exportingZip: boolean;
  descargaZipArcaLibro: () => void;
  solicitarAlertasEscritorio: () => void;
  ultimoDigitoInput: string;
  setUltimoDigitoInput: Dispatch<SetStateAction<string>>;
  cuitCompletoOpcional: string;
  setCuitCompletoOpcional: Dispatch<SetStateAction<string>>;
  loadLibroVencimientos: () => void;
  libroAviso: string;
  libroItems: VencRow[];
}) {
  const p = props;
  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-6 shadow-sm">
        <h2 className="text-lg font-semibold mb-1">Exportar Libro IVA Digital</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
          ZIP con archivos .txt ANSI para importación en ARCA / IVA Simple, más CSV orientativo interno.
          Validá con tu contador antes de presentar.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => p.descargaZipArcaLibro()}
            disabled={p.exportingZip}
            className="rounded-lg bg-slate-800 dark:bg-slate-700 text-white px-4 py-2.5 text-sm font-medium hover:bg-slate-900 disabled:opacity-50"
          >
            {p.exportingZip ? "Generando ZIP…" : `Descargar ZIP (${p.month}/${p.year})`}
          </button>
          <button
            type="button"
            onClick={() => p.solicitarAlertasEscritorio()}
            className="rounded-lg border border-zinc-300 dark:border-zinc-600 px-4 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-700/60"
          >
            Avisos de escritorio
          </button>
        </div>
      </div>

      <div className="rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-6 shadow-sm">
        <h2 className="text-lg font-semibold mb-1">Vencimientos Libro IVA (orientativo)</h2>
        <p className="text-sm text-zinc-500 mb-4">
          Según último dígito del CUIT. Confirmá fechas en AFIP / ARCA.
        </p>
        <div className="flex flex-wrap gap-4 items-end mb-4">
          <label className="flex flex-col gap-1 text-sm">
            Último dígito CUIT
            <input
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={p.ultimoDigitoInput}
              onChange={(e) => p.setUltimoDigitoInput(e.target.value.replace(/\D/g, "").slice(0, 1))}
              placeholder="3"
              className="rounded-lg border px-3 py-2 bg-white dark:bg-zinc-700 border-zinc-300 dark:border-zinc-600 w-20"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm flex-1 min-w-[12rem] max-w-md">
            CUIT completo (opcional)
            <input
              value={p.cuitCompletoOpcional}
              onChange={(e) =>
                p.setCuitCompletoOpcional(e.target.value.replace(/[^\d-]/g, "").slice(0, 13))
              }
              placeholder="30-xxxxxxxx-x"
              className="rounded-lg border px-3 py-2 bg-white dark:bg-zinc-700 border-zinc-300 dark:border-zinc-600 font-mono text-xs"
            />
          </label>
          <button
            type="button"
            className="text-sm text-emerald-600 hover:underline pb-2"
            onClick={() => p.loadLibroVencimientos()}
          >
            Actualizar
          </button>
        </div>
        {p.libroAviso ? (
          <p className="text-xs text-amber-800 dark:text-amber-100 mb-3 rounded bg-amber-500/10 border border-amber-600/30 p-2">
            {p.libroAviso}
          </p>
        ) : null}
        {p.libroItems.some((i) => i.alertaOrientativa) ? (
          <p className="text-sm mb-3 text-orange-800 dark:text-orange-100 bg-orange-500/15 border border-orange-600/30 rounded px-3 py-2">
            Hay vencimientos cercanos para tu dígito. Verificá en ARCA.
          </p>
        ) : null}
        <div className="overflow-x-auto rounded-lg border border-zinc-100 dark:border-zinc-700">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-left border-b bg-zinc-50 dark:bg-zinc-900/50 text-zinc-500">
                <th className="py-2.5 px-3">Período fiscal</th>
                <th className="py-2.5 px-3">Fecha referencia</th>
                <th className="py-2.5 px-3">Días</th>
              </tr>
            </thead>
            <tbody>
              {p.libroItems.map((row) => (
                <tr
                  key={`${row.periodo.key}-lib`}
                  className={`border-b border-zinc-100 dark:border-zinc-700/80 ${
                    row.alertaOrientativa ? "bg-orange-500/5" : ""
                  }`}
                >
                  <td className="py-2 px-3 font-medium">
                    {row.periodo.month}/{row.periodo.year}
                  </td>
                  <td className="py-2 px-3 font-mono text-xs">{row.fechaReferenciaOrientativaISO}</td>
                  <td className="py-2 px-3">
                    {typeof row.diasHastaOrientativo === "number" ? row.diasHastaOrientativo : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function TabPageIntro(props: { title: string; description: string; children?: ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{props.title}</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 max-w-2xl">{props.description}</p>
      {props.children}
    </div>
  );
}
