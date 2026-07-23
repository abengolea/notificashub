"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountingEntityId } from "@/lib/accounting/entities";
import { TabPageIntro } from "./contabilidad-shell";
import { BIEN_TIPO_LABELS, BIENES_TIPOS } from "@/lib/bienes-personales/constants";
import type { BienNaturaleza, BienTipo } from "@/lib/accounting/schemas";

type BienRecord = {
  id: string;
  year: number;
  naturaleza: BienNaturaleza;
  tipo: BienTipo;
  descripcion: string;
  valuacionFiscal: number;
  notes: string;
  pdfStoragePath: string;
};

type BienesPersonalesYearData = {
  year: number;
  totalActivos: number;
  totalPasivos: number;
  patrimonioNeto: number;
  activosPorTipo: Record<string, number>;
  minimoNoImponible: number;
  impuestoEstimado: number;
  bienes: BienRecord[];
};

function money(n: number): string {
  return (n || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 });
}

const emptyForm = {
  naturaleza: "activo" as BienNaturaleza,
  tipo: "inmueble" as BienTipo,
  descripcion: "",
  valuacionFiscal: "",
  notes: "",
  pdfStoragePath: "",
};

export function BienesPersonalesTab(props: {
  authHeader: HeadersInit;
  year: string;
  entityId: AccountingEntityId;
  entityQs: () => string;
}) {
  const { authHeader, year, entityId, entityQs } = props;
  const [data, setData] = useState<BienesPersonalesYearData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiNote, setAiNote] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [reviewText, setReviewText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounting/bienes?year=${encodeURIComponent(year)}&${entityQs()}`, {
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
      const res = await fetch(`/api/accounting/bienes/export?year=${encodeURIComponent(year)}&${entityQs()}`, {
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
      a.download = `BienesPersonales_${entityId}_${year}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setExporting(false);
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(emptyForm);
    setAiNote("");
  };

  const startEdit = (b: BienRecord) => {
    setEditingId(b.id);
    setForm({
      naturaleza: b.naturaleza,
      tipo: b.tipo,
      descripcion: b.descripcion,
      valuacionFiscal: String(b.valuacionFiscal),
      notes: b.notes,
      pdfStoragePath: b.pdfStoragePath,
    });
    setAiNote("");
  };

  const saveBien = async () => {
    const valuacionFiscal = parseFloat(form.valuacionFiscal.replace(",", "."));
    if (!form.descripcion.trim() || !Number.isFinite(valuacionFiscal) || valuacionFiscal <= 0) {
      alert("Completá descripción y valuación (mayor a 0).");
      return;
    }
    setSaving(true);
    try {
      const body = {
        year: parseInt(year, 10),
        naturaleza: form.naturaleza,
        tipo: form.tipo,
        descripcion: form.descripcion.trim(),
        valuacionFiscal,
        notes: form.notes.trim() || undefined,
        pdfStoragePath: form.pdfStoragePath || undefined,
        entity: entityId,
      };
      const url = editingId ? `/api/accounting/bienes/${editingId}?${entityQs()}` : `/api/accounting/bienes?${entityQs()}`;
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(typeof j?.error === "string" ? j.error : "No se pudo guardar el bien");
        return;
      }
      cancelEdit();
      await load();
    } finally {
      setSaving(false);
    }
  };

  const deleteBien = async (id: string) => {
    if (!confirm("¿Eliminar este registro?")) return;
    const res = await fetch(`/api/accounting/bienes/${id}?${entityQs()}`, {
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

  const onAiFile = async (file: File | null) => {
    if (!file) return;
    setAiLoading(true);
    setAiNote("");
    try {
      const fd = new FormData();
      fd.set("pdf", file);
      fd.set("entity", entityId);
      const res = await fetch(`/api/accounting/bienes/pdf-ingest?${entityQs()}`, {
        method: "POST",
        headers: authHeader,
        body: fd,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(typeof j?.error === "string" ? j.error : "No se pudo leer el PDF con IA");
        return;
      }
      const ex = j.extracted ?? {};
      setForm({
        naturaleza: ex.naturaleza === "pasivo" ? "pasivo" : "activo",
        tipo: (BIENES_TIPOS as readonly string[]).includes(ex.tipo) ? ex.tipo : "otro",
        descripcion: String(ex.descripcion ?? ""),
        valuacionFiscal: ex.valuacionFiscal ? String(ex.valuacionFiscal) : "",
        notes: String(ex.notes ?? ""),
        pdfStoragePath: String(j.pdfStoragePath ?? ""),
      });
      setAiNote("Datos leídos por IA — revisá y corregí antes de guardar (sobre todo la valuación fiscal).");
    } finally {
      setAiLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const runReview = async () => {
    setReviewing(true);
    setReviewText("");
    try {
      const res = await fetch(`/api/accounting/bienes/verify-ai?${entityQs()}`, {
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

  return (
    <div className="space-y-6">
      <TabPageIntro
        title={`Bienes Personales · al 31/12/${year}`}
        description="Registro de patrimonio (activos y deudas). El total y el impuesto estimado son orientativos: verificá los parámetros del año vigente con tu contador antes de declarar."
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
          {exporting ? "Generando…" : "Descargar detalle (Excel)"}
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
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Total activos</p>
          <p className="text-lg font-bold mt-1">{money(data?.totalActivos ?? 0)}</p>
        </div>
        <div className="rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-4 shadow-sm">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Total pasivos</p>
          <p className="text-lg font-bold mt-1">{money(data?.totalPasivos ?? 0)}</p>
        </div>
        <div className="rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-4 shadow-sm">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Patrimonio neto</p>
          <p className="text-lg font-bold mt-1 text-emerald-700 dark:text-emerald-400">
            {money(data?.patrimonioNeto ?? 0)}
          </p>
        </div>
        <div className="rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-4 shadow-sm">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Impuesto estimado (orientativo)</p>
          <p className="text-lg font-bold mt-1 text-amber-700 dark:text-amber-400">
            {money(data?.impuestoEstimado ?? 0)}
          </p>
        </div>
      </div>

      <div className="rounded-xl bg-white dark:bg-zinc-800 border p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">{editingId ? "Editar bien o deuda" : "Cargar bien o deuda"}</h3>
            <p className="text-xs text-zinc-500 mt-1">
              Cargá la valuación fiscal ya calculada (para inmuebles/rodados verificá la tabla oficial ARCA
              del año; para cuentas/inversiones, el saldo al 31/12).
            </p>
          </div>
          <label className="rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 px-3 py-2 text-xs font-medium cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-950/30">
            {aiLoading ? "Leyendo PDF con IA…" : "Cargar desde PDF (IA)"}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              disabled={aiLoading}
              onChange={(e) => void onAiFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>

        {aiNote ? (
          <p className="text-xs rounded-lg bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 text-indigo-900 dark:text-indigo-100 p-2">
            {aiNote}
          </p>
        ) : null}

        <div className="grid sm:grid-cols-6 gap-2 items-end">
          <label className="flex flex-col gap-1 text-xs">
            Naturaleza
            <select
              value={form.naturaleza}
              onChange={(e) => setForm((s) => ({ ...s, naturaleza: e.target.value as BienNaturaleza }))}
              className="rounded-lg border px-2 py-2 text-sm bg-white dark:bg-zinc-900"
            >
              <option value="activo">Activo</option>
              <option value="pasivo">Deuda (pasivo)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Tipo
            <select
              value={form.tipo}
              onChange={(e) => setForm((s) => ({ ...s, tipo: e.target.value as BienTipo }))}
              className="rounded-lg border px-2 py-2 text-sm bg-white dark:bg-zinc-900"
            >
              {BIENES_TIPOS.map((t) => (
                <option key={t} value={t}>
                  {BIEN_TIPO_LABELS[t]}
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
              placeholder="Ej: Depto CABA, Auto 2019, Plazo fijo Banco X"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Valuación fiscal
            <input
              type="text"
              inputMode="decimal"
              value={form.valuacionFiscal}
              onChange={(e) => setForm((s) => ({ ...s, valuacionFiscal: e.target.value }))}
              className="rounded-lg border px-2 py-2 text-sm bg-white dark:bg-zinc-900"
              placeholder="0,00"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveBien()}
              className="rounded-lg bg-emerald-600 text-white px-3 py-2 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 flex-1"
            >
              {saving ? "Guardando…" : editingId ? "Guardar cambios" : "Agregar"}
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
          <label className="flex flex-col gap-1 text-xs sm:col-span-6">
            Notas (opcional)
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))}
              className="rounded-lg border px-2 py-2 text-sm bg-white dark:bg-zinc-900"
              placeholder="Ej: partida inmobiliaria, dominio, banco/sucursal"
            />
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-zinc-500 border-b">
                <th className="py-1 pr-2">Naturaleza</th>
                <th className="py-1 pr-2">Tipo</th>
                <th className="py-1 pr-2">Descripción</th>
                <th className="py-1 pr-2 text-right">Valuación</th>
                <th className="py-1"></th>
              </tr>
            </thead>
            <tbody>
              {!data?.bienes?.length ? (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-zinc-500">
                    {loading ? "Cargando…" : `Sin bienes cargados para ${year}.`}
                  </td>
                </tr>
              ) : (
                data.bienes.map((b) => (
                  <tr
                    key={b.id}
                    className={`border-b border-zinc-100 dark:border-zinc-700/50 ${
                      editingId === b.id ? "bg-emerald-50/60 dark:bg-emerald-950/20" : ""
                    }`}
                  >
                    <td className="py-1 pr-2">{b.naturaleza === "activo" ? "Activo" : "Deuda"}</td>
                    <td className="py-1 pr-2">{BIEN_TIPO_LABELS[b.tipo] ?? b.tipo}</td>
                    <td className="py-1 pr-2">
                      {b.descripcion}
                      {b.pdfStoragePath ? (
                        <span className="ml-1 text-[10px] text-indigo-600 dark:text-indigo-400">PDF</span>
                      ) : null}
                    </td>
                    <td className="py-1 pr-2 text-right">{money(b.valuacionFiscal)}</td>
                    <td className="py-1 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => startEdit(b)}
                        className="text-indigo-600 hover:underline text-xs mr-3"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteBien(b.id)}
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
    </div>
  );
}
