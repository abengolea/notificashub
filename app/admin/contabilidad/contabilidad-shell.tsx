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


export { ArcaExportPanel as ArcaTab } from "./arca-export-panel";

export function TabPageIntro(props: { title: string; description: string; children?: ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{props.title}</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 max-w-2xl">{props.description}</p>
      {props.children}
    </div>
  );
}
