"use client";

import { useCallback, useEffect, useState } from "react";
import type { AccountingEntityId } from "@/lib/accounting/entities";
import { TabPageIntro } from "./contabilidad-shell";
import { DEDUCCION_CATEGORIA_LABELS, DEDUCCION_PERSONAL_CATEGORIES } from "@/lib/ganancias/constants";
import type { DeduccionCategoria } from "@/lib/accounting/schemas";

const ACCOUNTING_CATEGORY_LABELS: Record<string, string> = {
  insumos: "Insumos",
  servicios: "Servicios",
  honorarios: "Honorarios",
  alquiler: "Alquiler",
  sueldos: "Sueldos",
  impuestos: "Impuestos",
  equipamiento: "Equipamiento",
  marketing: "Marketing",
  aporte_reintegro_socio: "Aporte / reintegro socio",
  otro: "Otro",
};

type MonthSummary = {
  month: number;
  label: string;
  ingresoBruto: number;
  gastosPorCategoria: Record<string, number>;
  totalGastosDeducibles: number;
  deduccionesPersonales: number;
  resultadoNeto: number;
};

type DeduccionRecord = {
  id: string;
  year: number;
  categoria: DeduccionCategoria;
  descripcion: string;
  importe: number;
  fecha: string;
  notes: string;
};

type GananciasYearData = {
  year: number;
  months: MonthSummary[];
  totalIngresoBruto: number;
  totalGastosDeducibles: number;
  totalDeduccionesPersonales: number;
  totalResultadoNeto: number;
  deducciones: DeduccionRecord[];
};

function money(n: number): string {
  return (n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 });
}

const emptyDeduccionForm = {
  categoria: "obra_social" as DeduccionCategoria,
  descripcion: "",
  importe: "",
  fecha: "",
};

export function GananciasTab(props: {
  authHeader: HeadersInit;
  year: string;
  month: string;
  entityId: AccountingEntityId;
  entityQs: () => string;
  isIndividual: boolean;
}) {
  const { authHeader, year, month, entityId, entityQs, isIndividual } = props;
  const [data, setData] = useState<GananciasYearData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [form, setForm] = useState(emptyDeduccionForm);
  const [savingDeduccion, setSavingDeduccion] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewText, setReviewText] = useState("");
  const [showDetalle, setShowDetalle] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounting/ganancias?year=${encodeURIComponent(year)}&${entityQs()}`, {
        headers: authHeader,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(typeof j?.error === "string" ? j.error : `HTTP ${res.status}`);
        return;
      }
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [authHeader, year, entityQs]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setReviewText("");
  }, [year]);

  const downloadExcel = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/accounting/ganancias/export?year=${encodeURIComponent(year)}&${entityQs()}`, {
        headers: authHeader,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(typeof j?.error === "string" ? j.error : "No se pudo exportar");
        return;
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `Ganancias_resumen_${entityId}_${year}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setExporting(false);
    }
  };

  const runReview = async () => {
    setReviewing(true);
    setReviewText("");
    try {
      const res = await fetch(`/api/accounting/ganancias/verify-ai?${entityQs()}`, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ year: parseInt(year, 10), entity: entityId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(typeof j?.error === "string" ? j.error : "No se pudo revisar con IA");
        return;
      }
      setReviewText(String(j.texto ?? ""));
    } finally {
      setReviewing(false);
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(emptyDeduccionForm);
  };

  const startEdit = (d: DeduccionRecord) => {
    setEditingId(d.id);
    setForm({
      categoria: d.categoria,
      descripcion: d.descripcion,
      importe: String(d.importe),
      fecha: d.fecha,
    });
  };

  const saveDeduccion = async () => {
    const importe = parseFloat(form.importe.replace(",", "."));
    if (!form.descripcion.trim() || !Number.isFinite(importe) || importe <= 0) {
      alert("Completá descripción e importe (mayor a 0).");
      return;
    }
    setSavingDeduccion(true);
    try {
      const body = {
        year: parseInt(year, 10),
        categoria: form.categoria,
        descripcion: form.descripcion.trim(),
        importe,
        fecha: form.fecha || undefined,
        entity: entityId,
      };
      const url = editingId
        ? `/api/accounting/deducciones/${editingId}?${entityQs()}`
        : `/api/accounting/deducciones?${entityQs()}`;
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(typeof j?.error === "string" ? j.error : "No se pudo guardar la deducción");
        return;
      }
      cancelEdit();
      await load();
    } finally {
      setSavingDeduccion(false);
    }
  };

  const deleteDeduccion = async (id: string) => {
    if (!confirm("¿Eliminar esta deducción?")) return;
    const res = await fetch(`/api/accounting/deducciones/${id}?${entityQs()}`, {
      method: "DELETE",
      headers: authHeader,
    });
    if (!res.ok) {
      alert("No se pudo eliminar");
      return;
    }
    if (editingId === id) cancelEdit();
    await load();
  };

  const selectedMonth = parseInt(month, 10);
  const ytd = data?.months.filter((m) => m.month <= selectedMonth) ?? [];
  const ytdIngreso = ytd.reduce((a, m) => a + m.ingresoBruto, 0);
  const ytdGastos = ytd.reduce((a, m) => a + m.totalGastosDeducibles, 0);
  const ytdDeducciones = ytd.reduce((a, m) => a + m.deduccionesPersonales, 0);
  const ytdResultado = ytdIngreso - ytdGastos - ytdDeducciones;

  const categoriaTotales = new Map<string, number>();
  for (const m of data?.months ?? []) {
    for (const [cat, monto] of Object.entries(m.gastosPorCategoria)) {
      categoriaTotales.set(cat, (categoriaTotales.get(cat) ?? 0) + monto);
    }
  }
  const categoriasOrdenadas = Array.from(categoriaTotales.entries()).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      <TabPageIntro
        title={`Ganancias · ${year}`}
        description="Ingresos devengados (facturas de venta) menos gastos marcados como deducibles, por mes. Insumo para armar la DDJJ anual, no una liquidación certificada."
      />

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg border px-4 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
        >
          {loading ? "Actualizando…" : "Actualizar"}
        </button>
        <button
          type="button"
          onClick={() => void downloadExcel()}
          disabled={exporting}
          className="rounded-lg bg-emerald-600 text-white px-4 py-2 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
        >
          {exporting ? "Generando…" : "Descargar resumen anual (Excel)"}
        </button>
        <button
          type="button"
          onClick={() => void runReview()}
          disabled={reviewing}
          className="rounded-lg border border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 px-4 py-2 text-sm font-medium hover:bg-violet-50 dark:hover:bg-violet-950/30 disabled:opacity-50"
        >
          {reviewing ? "Revisando…" : "Revisar con IA"}
        </button>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {reviewText ? (
        <div className="rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-950/20 p-4 text-sm text-violet-950 dark:text-violet-100">
          <p className="font-semibold mb-1">Revisión de IA</p>
          <p>{reviewText}</p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-4 shadow-sm">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Ingreso bruto acum. al mes</p>
          <p className="text-lg font-bold mt-1">{money(ytdIngreso)}</p>
        </div>
        <div className="rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-4 shadow-sm">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Gastos deducibles acum.</p>
          <p className="text-lg font-bold mt-1">{money(ytdGastos)}</p>
        </div>
        {isIndividual ? (
          <div className="rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-4 shadow-sm">
            <p className="text-xs text-zinc-500 uppercase tracking-wide">Deducciones personales acum.</p>
            <p className="text-lg font-bold mt-1">{money(ytdDeducciones)}</p>
          </div>
        ) : null}
        <div className="rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-4 shadow-sm">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Resultado neto acum. (estimado)</p>
          <p className="text-lg font-bold mt-1 text-emerald-700 dark:text-emerald-400">{money(ytdResultado)}</p>
        </div>
      </div>

      <div className="rounded-xl bg-white dark:bg-zinc-800 border overflow-hidden shadow-sm">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="border-b bg-zinc-50 dark:bg-zinc-900/60">
              <th className="text-left py-2 px-3">Mes</th>
              <th className="text-right py-2 px-3">Ingreso bruto</th>
              <th className="text-right py-2 px-3">Gastos deducibles</th>
              {isIndividual ? <th className="text-right py-2 px-3">Deducciones personales</th> : null}
              <th className="text-right py-2 px-3">Resultado neto</th>
            </tr>
          </thead>
          <tbody>
            {!data?.months?.length ? (
              <tr>
                <td colSpan={isIndividual ? 5 : 4} className="py-8 text-center text-zinc-500">
                  {loading ? "Cargando…" : "Sin datos"}
                </td>
              </tr>
            ) : (
              data.months.map((m) => (
                <tr
                  key={m.month}
                  className={`border-b border-zinc-100 dark:border-zinc-700/50 ${
                    m.month === selectedMonth ? "bg-emerald-50/60 dark:bg-emerald-950/20" : ""
                  }`}
                >
                  <td className="py-2 px-3 font-medium">{m.label}</td>
                  <td className="py-2 px-3 text-right">{money(m.ingresoBruto)}</td>
                  <td className="py-2 px-3 text-right">{money(m.totalGastosDeducibles)}</td>
                  {isIndividual ? (
                    <td className="py-2 px-3 text-right">{money(m.deduccionesPersonales)}</td>
                  ) : null}
                  <td className="py-2 px-3 text-right font-medium">{money(m.resultadoNeto)}</td>
                </tr>
              ))
            )}
          </tbody>
          {data ? (
            <tfoot>
              <tr className="border-t-2 font-semibold">
                <td className="py-2 px-3">Total {year}</td>
                <td className="py-2 px-3 text-right">{money(data.totalIngresoBruto)}</td>
                <td className="py-2 px-3 text-right">{money(data.totalGastosDeducibles)}</td>
                {isIndividual ? (
                  <td className="py-2 px-3 text-right">{money(data.totalDeduccionesPersonales)}</td>
                ) : null}
                <td className="py-2 px-3 text-right">{money(data.totalResultadoNeto)}</td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      <div className="rounded-xl bg-white dark:bg-zinc-800 border shadow-sm">
        <button
          type="button"
          onClick={() => setShowDetalle((s) => !s)}
          className="w-full text-left px-5 py-4 flex items-center justify-between gap-3"
        >
          <span className="font-semibold text-sm">Detalle de gastos deducibles por categoría · {year}</span>
          <span className="text-zinc-400 text-xs">{showDetalle ? "▲" : "▼"}</span>
        </button>
        {showDetalle ? (
          <div className="px-5 pb-5">
            {categoriasOrdenadas.length === 0 ? (
              <p className="text-sm text-zinc-500">Sin gastos deducibles cargados para {year}.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-500 border-b">
                    <th className="py-1 pr-2">Categoría</th>
                    <th className="py-1 text-right">Total anual</th>
                    <th className="py-1 pl-4 text-right">% del total deducible</th>
                  </tr>
                </thead>
                <tbody>
                  {categoriasOrdenadas.map(([cat, monto]) => (
                    <tr key={cat} className="border-b border-zinc-100 dark:border-zinc-700/50">
                      <td className="py-1 pr-2">{ACCOUNTING_CATEGORY_LABELS[cat] ?? cat}</td>
                      <td className="py-1 text-right">{money(monto)}</td>
                      <td className="py-1 pl-4 text-right text-zinc-500">
                        {data && data.totalGastosDeducibles > 0
                          ? `${((monto / data.totalGastosDeducibles) * 100).toFixed(1)}%`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : null}
      </div>

      {isIndividual ? (
        <div className="rounded-xl bg-white dark:bg-zinc-800 border p-5 shadow-sm space-y-4">
          <div>
            <h3 className="font-semibold">{editingId ? "Editar deducción personal" : "Deducciones personales"}</h3>
            <p className="text-xs text-zinc-500 mt-1">
              Obra social, honorarios médicos, alquiler de vivienda, donaciones, etc. — se usan para armar la
              DDJJ anual de Ganancias personas humanas.
            </p>
          </div>

          <div className="grid sm:grid-cols-5 gap-2 items-end">
            <label className="flex flex-col gap-1 text-xs sm:col-span-1">
              Categoría
              <select
                value={form.categoria}
                onChange={(e) => setForm((s) => ({ ...s, categoria: e.target.value as DeduccionCategoria }))}
                className="rounded-lg border px-2 py-2 text-sm bg-white dark:bg-zinc-900"
              >
                {DEDUCCION_PERSONAL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {DEDUCCION_CATEGORIA_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs sm:col-span-2">
              Descripción
              <input
                type="text"
                value={form.descripcion}
                onChange={(e) => setForm((s) => ({ ...s, descripcion: e.target.value }))}
                className="rounded-lg border px-2 py-2 text-sm bg-white dark:bg-zinc-900"
                placeholder="Ej: OSDE cuota mensual"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Fecha (opcional)
              <input
                type="date"
                value={form.fecha}
                onChange={(e) => setForm((s) => ({ ...s, fecha: e.target.value }))}
                className="rounded-lg border px-2 py-2 text-sm bg-white dark:bg-zinc-900"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Importe
              <input
                type="text"
                inputMode="decimal"
                value={form.importe}
                onChange={(e) => setForm((s) => ({ ...s, importe: e.target.value }))}
                className="rounded-lg border px-2 py-2 text-sm bg-white dark:bg-zinc-900"
                placeholder="0,00"
              />
            </label>
            <div className="flex gap-2 sm:col-span-1">
              <button
                type="button"
                disabled={savingDeduccion}
                onClick={() => void saveDeduccion()}
                className="rounded-lg bg-emerald-600 text-white px-3 py-2 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 flex-1"
              >
                {savingDeduccion ? "Guardando…" : editingId ? "Guardar cambios" : "Agregar"}
              </button>
              {editingId ? (
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="rounded-lg border px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-700/60"
                >
                  Cancelar
                </button>
              ) : null}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left text-zinc-500 border-b">
                  <th className="py-1 pr-2">Fecha</th>
                  <th className="py-1 pr-2">Categoría</th>
                  <th className="py-1 pr-2">Descripción</th>
                  <th className="py-1 pr-2 text-right">Importe</th>
                  <th className="py-1"></th>
                </tr>
              </thead>
              <tbody>
                {!data?.deducciones?.length ? (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-zinc-500">
                      Sin deducciones cargadas para {year}.
                    </td>
                  </tr>
                ) : (
                  data.deducciones.map((d) => (
                    <tr
                      key={d.id}
                      className={`border-b border-zinc-100 dark:border-zinc-700/50 ${
                        editingId === d.id ? "bg-emerald-50/60 dark:bg-emerald-950/20" : ""
                      }`}
                    >
                      <td className="py-1 pr-2">{d.fecha || "—"}</td>
                      <td className="py-1 pr-2">{DEDUCCION_CATEGORIA_LABELS[d.categoria] ?? d.categoria}</td>
                      <td className="py-1 pr-2">{d.descripcion}</td>
                      <td className="py-1 pr-2 text-right">{money(d.importe)}</td>
                      <td className="py-1 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => startEdit(d)}
                          className="text-indigo-600 hover:underline text-xs mr-3"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteDeduccion(d.id)}
                          className="text-red-600 hover:underline text-xs"
                        >
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
