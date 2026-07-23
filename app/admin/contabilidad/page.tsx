"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArcaTab, ContabTabBar, TabPageIntro, type TabId } from "./contabilidad-shell";
import { periodLabel as formatPeriodLabel } from "./contabilidad-tabs";
import {
  PagoForm,
  buildPagoSubmitBody,
  emptyPagoForm,
  pagoFormFromExtract,
  pagoFormFromRecord,
  type PagoFormState,
} from "./pago-form";
import { AuditoriaIvaTab } from "./auditoria-iva-tab";
import { GananciasTab } from "./ganancias-tab";
import { BienesPersonalesTab } from "./bienes-personales-tab";
import { DASHBOARD_TOKEN_STORAGE_KEY } from "@/lib/dashboard-session";
import { fechaFieldToUi } from "@/lib/accounting/serialize";
import { ARCA_ARCHIVO_IDS, ARCA_FILE_NAMES, type ArcaArchivoId } from "@/lib/arca-export/constants";
import {
  ACCOUNTING_ENTITY_OPTIONS,
  DEFAULT_ACCOUNTING_ENTITY_ID,
  getAccountingEntity,
  isAccountingEntityId,
  type AccountingEntity,
  type AccountingEntityId,
} from "@/lib/accounting/entities";

const MONTHS = [
  { v: "1", label: "Enero" },
  { v: "2", label: "Febrero" },
  { v: "3", label: "Marzo" },
  { v: "4", label: "Abril" },
  { v: "5", label: "Mayo" },
  { v: "6", label: "Junio" },
  { v: "7", label: "Julio" },
  { v: "8", label: "Agosto" },
  { v: "9", label: "Septiembre" },
  { v: "10", label: "Octubre" },
  { v: "11", label: "Noviembre" },
  { v: "12", label: "Diciembre" },
];

const CONTAB_DIGITO_STORAGE = "notificashub-contab-ultimodigito";
const CONTAB_ENTITY_STORAGE = "notificashub-contab-entity";

type VencApiRow = {
  periodo: { year: number; month: number; key: string };
  todasISO: string;
  grupoCuilISO: string;
  fechaReferenciaOrientativaISO: string;
  diasHastaOrientativo: number | null;
  alertaOrientativa: boolean;
};

function money(n: number): string {
  return n.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
  });
}

function periodLabel(month: string, year: string): string {
  return formatPeriodLabel(month, year, MONTHS);
}

function CollapsibleSection(props: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  badge?: string;
  children: ReactNode;
}) {
  const { title, subtitle, defaultOpen = false, badge, children } = props;
  return (
    <details
      open={defaultOpen}
      className="rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-sm group"
    >
      <summary className="cursor-pointer list-none px-5 py-4 flex items-center justify-between gap-3 select-none [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
            {badge ? (
              <span className="text-[10px] uppercase tracking-wide font-medium px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">
                {badge}
              </span>
            ) : null}
          </div>
          {subtitle ? <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">{subtitle}</p> : null}
        </div>
        <span className="shrink-0 text-zinc-400 text-xs group-open:rotate-180 transition-transform">▼</span>
      </summary>
      <div className="px-5 pb-5 pt-0 border-t border-zinc-100 dark:border-zinc-700/80">{children}</div>
    </details>
  );
}

function EmptyListHint(props: { message: string }) {
  return (
    <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center py-10 px-4">{props.message}</p>
  );
}

function nowPeriod() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export default function ContabilidadPage() {
  const [token, setToken] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("panel");
  const { year: yNow, month: mNow } = nowPeriod();
  const [year, setYear] = useState(yNow.toString());
  const [month, setMonth] = useState(mNow.toString());
  const [entityId, setEntityId] = useState<AccountingEntityId>(DEFAULT_ACCOUNTING_ENTITY_ID);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [resumen, setResumen] = useState<Record<string, unknown> | null>(null);

  const [facturas, setFacturas] = useState<Record<string, unknown>[]>([]);
  const [cobros, setCobros] = useState<Record<string, unknown>[]>([]);
  const [pagos, setPagos] = useState<Record<string, unknown>[]>([]);

  const [ultimoDigitoInput, setUltimoDigitoInput] = useState("");
  const [cuitCompletoOpcional, setCuitCompletoOpcional] = useState("");
  const [libroItems, setLibroItems] = useState<VencApiRow[]>([]);
  const [libroAviso, setLibroAviso] = useState("");
  const [exportingZip, setExportingZip] = useState(false);
  const [exportingCm05, setExportingCm05] = useState(false);

  const entity = useMemo(() => getAccountingEntity(entityId), [entityId]);

  useEffect(() => {
    if (tab === "bienes" && !entity.isIndividual) setTab("panel");
  }, [entity.isIndividual, tab]);

  const authHeader = useMemo((): HeadersInit => {
    return token ? ({ Authorization: `Bearer ${token}` } as HeadersInit) : {};
  }, [token]);

  useEffect(() => {
    setToken(sessionStorage.getItem(DASHBOARD_TOKEN_STORAGE_KEY));
    try {
      const stored = sessionStorage.getItem(CONTAB_ENTITY_STORAGE);
      if (isAccountingEntityId(stored)) setEntityId(stored);
    } catch {
      //
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(CONTAB_ENTITY_STORAGE, entityId);
    } catch {
      //
    }
  }, [entityId]);

  const qh = useCallback(
    () =>
      `year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}&entity=${encodeURIComponent(entityId)}`,
    [year, month, entityId]
  );

  const entityQs = useCallback(
    () => `entity=${encodeURIComponent(entityId)}`,
    [entityId]
  );

  const loadResumen = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`/api/accounting/resumen?${qh()}`, { headers: authHeader });
    if (res.status === 401) {
      sessionStorage.removeItem(DASHBOARD_TOKEN_STORAGE_KEY);
      setToken(null);
      return;
    }
    if (!res.ok) {
      setError("No se pudo cargar el resumen");
      return;
    }
    setResumen(await res.json());
  }, [token, authHeader, qh]);

  const loadLists = useCallback(async () => {
    if (!token) return;
    const q = qh();
    const [fRes, cRes, pRes] = await Promise.all([
      fetch(`/api/accounting/facturas?${q}`, { headers: authHeader }),
      fetch(`/api/accounting/cobros?${q}`, { headers: authHeader }),
      fetch(`/api/accounting/pagos?${q}`, { headers: authHeader }),
    ]);

    const handleFail = async (label: string, res: Response) => {
      if (res.status === 401) {
        sessionStorage.removeItem(DASHBOARD_TOKEN_STORAGE_KEY);
        setToken(null);
      }
      if (!res.ok) {
        try {
          const j = await res.json();
          setError(`${label}: ${typeof j?.error === "string" ? j.error : res.status}`);
        } catch {
          setError(`${label}: error HTTP ${res.status}`);
        }
      }
    };

    let failed = false;
    if (!fRes.ok) {
      failed = true;
      await handleFail("Facturas", fRes);
    }
    if (!cRes.ok) {
      failed = true;
      await handleFail("Cobros", cRes);
    }
    if (!pRes.ok) {
      failed = true;
      await handleFail("Pagos", pRes);
    }
    if (!failed && fRes.ok) {
      const j = await fRes.json();
      setFacturas(j.facturas ?? []);
    }
    if (!failed && cRes.ok) {
      const j = await cRes.json();
      setCobros(j.cobros ?? []);
    }
    if (!failed && pRes.ok) {
      const j = await pRes.json();
      setPagos(j.pagos ?? []);
    }
  }, [token, authHeader, qh]);

  useEffect(() => {
    try {
      const s = sessionStorage.getItem(CONTAB_DIGITO_STORAGE);
      if (s && /^[0-9]$/.test(s)) setUltimoDigitoInput(s);
    } catch {
      //
    }
  }, []);

  useEffect(() => {
    const d = ultimoDigitoInput.trim().slice(-1);
    if (!/^[0-9]$/.test(d)) return;
    try {
      sessionStorage.setItem(CONTAB_DIGITO_STORAGE, d);
    } catch {
      //
    }
  }, [ultimoDigitoInput]);

  const loadLibroVencimientos = useCallback(async () => {
    if (!token) return;
    try {
      const qs = new URLSearchParams();
      if (cuitCompletoOpcional.trim()) qs.set("cuit", cuitCompletoOpcional.trim());
      else {
        const d = ultimoDigitoInput.trim().slice(-1);
        if (/^[0-9]$/.test(d)) qs.set("ultimoDigito", d);
      }
      const res = await fetch(`/api/accounting/vencimientos-libro?${qs.toString()}`, {
        headers: authHeader,
      });
      if (res.status === 401) {
        sessionStorage.removeItem(DASHBOARD_TOKEN_STORAGE_KEY);
        setToken(null);
        return;
      }
      const j = (await res.json()) as { items?: VencApiRow[]; avisoLegal?: string };
      setLibroItems(j.items ?? []);
      setLibroAviso(typeof j.avisoLegal === "string" ? j.avisoLegal : "");
    } catch {
      setLibroAviso("No se pudo obtener el panel de vencimientos Libro IVA.");
    }
  }, [token, ultimoDigitoInput, cuitCompletoOpcional, authHeader]);

  useEffect(() => {
    if (!token) return;
    loadLibroVencimientos();
  }, [token, loadLibroVencimientos]);

  useEffect(() => {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    for (const it of libroItems) {
      if (!it.alertaOrientativa || typeof it.diasHastaOrientativo !== "number") continue;
      if (it.diasHastaOrientativo > 5 || it.diasHastaOrientativo < -21) continue;
      const k = `notif-hub-libro-${it.periodo.key}`;
      try {
        if (sessionStorage.getItem(k) === "1") continue;
      } catch {
        //
      }
      new Notification(`Libro IVA — período fiscal ${it.periodo.month}/${it.periodo.year}`, {
        body: `Fecha de referencia orientativa ${it.fechaReferenciaOrientativaISO}. Contrastá contra ARCA oficial.`,
      });
      try {
        sessionStorage.setItem(k, "1");
      } catch {
        //
      }
    }
  }, [libroItems]);

  const solicitarAlertasEscritorio = async () => {
    if (typeof Notification === "undefined") return;
    await Notification.requestPermission();
  };

  const descargaArcaArchivo = useCallback(
    async (archivo: ArcaArchivoId): Promise<boolean> => {
      if (!token) return false;
      const yNum = parseInt(year, 10);
      const mNum = parseInt(month, 10);
      const res = await fetch(
        `/api/accounting/export-libro-iva?year=${encodeURIComponent(String(yNum))}&month=${encodeURIComponent(String(mNum))}&archivo=${archivo}&entity=${encodeURIComponent(entityId)}`,
        { headers: authHeader }
      );
      if (res.status === 401) {
        sessionStorage.removeItem(DASHBOARD_TOKEN_STORAGE_KEY);
        setToken(null);
        return false;
      }
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const j = (await res.json()) as { detalle?: string; error?: string; validation?: { warnings?: string[] } };
          msg = j.detalle ?? j.error ?? msg;
          if (j.validation?.warnings?.length) {
            msg += "\n\n" + j.validation.warnings.join("\n");
          }
        } catch {
          //
        }
        alert(msg);
        return false;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const names: Record<ArcaArchivoId, string> = {
        compras_cbte: ARCA_FILE_NAMES.comprasCbte,
        compras_ali: ARCA_FILE_NAMES.comprasAli,
        ventas_cbte: ARCA_FILE_NAMES.ventasCbte,
        ventas_ali: ARCA_FILE_NAMES.ventasAli,
      };
      a.download = names[archivo];
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return true;
    },
    [token, year, month, entityId, authHeader]
  );

  const descargaArcaArchivoWrapped = useCallback(
    async (archivo: ArcaArchivoId) => {
      setExportingZip(true);
      try {
        await descargaArcaArchivo(archivo);
      } finally {
        setExportingZip(false);
      }
    },
    [descargaArcaArchivo]
  );

  const descargaArcaTodos = useCallback(async () => {
    setExportingZip(true);
    try {
      for (const id of ARCA_ARCHIVO_IDS) {
        const ok = await descargaArcaArchivo(id);
        if (!ok) break;
        await new Promise((r) => setTimeout(r, 400));
      }
    } finally {
      setExportingZip(false);
    }
  }, [descargaArcaArchivo]);

  const descargaCm05 = useCallback(async () => {
    const yNum = parseInt(year, 10);
    const mNum = parseInt(month, 10);
    if (!Number.isFinite(yNum) || !Number.isFinite(mNum)) {
      setError("Mes/año inválidos");
      return;
    }
    setExportingCm05(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/accounting/export-cm05?year=${encodeURIComponent(String(yNum))}&month=${encodeURIComponent(String(mNum))}&entity=${encodeURIComponent(entityId)}`,
        { headers: authHeader }
      );
      if (!res.ok) {
        let msg = "No se pudo exportar CM05";
        try {
          const j = (await res.json()) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          /* ignore */
        }
        setError(msg);
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(cd);
      const name = match?.[1] ?? `CM05_ingresos_gastos_${yNum}-${String(mNum).padStart(2, "0")}.xls`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setExportingCm05(false);
    }
  }, [year, month, entityId, authHeader]);

  const refreshAll = async () => {
    await Promise.all([loadResumen(), loadLists()]);
  };

  const tabCounts = useMemo((): Partial<Record<TabId, number>> => {
    if (!resumen) return {};
    return {
      facturas: Number(resumen.libroFacturasCargadas) || 0,
      cobros: Number(resumen.cobrosRegistrados) || 0,
      pagos: Number(resumen.pagosRegistrados) || 0,
    };
  }, [resumen]);

  useEffect(() => {
    setError(null);
    setResumen(null);
    setFacturas([]);
    setCobros([]);
    setPagos([]);
    if (!token) return;
    (async () => {
      setLoading(true);
      await Promise.all([loadResumen(), loadLists()]);
      setLoading(false);
    })();
  }, [token, year, month, entityId, loadResumen, loadLists]);

  if (!token) {
    return (
      <div className="min-h-screen bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center p-8">
        <div className="max-w-md text-center rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-8 shadow">
          <p className="text-zinc-700 dark:text-zinc-300 mb-4">
            Necesitás iniciar sesión en la página principal para ver la contabilidad.
          </p>
          <Link
            href="/"
            className="inline-flex rounded-lg bg-emerald-600 px-5 py-2.5 font-medium text-white hover:bg-emerald-700"
          >
            Ir al dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 pb-16">
        <header className="flex flex-wrap gap-4 items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Contabilidad</h1>
            <p className="text-sm text-zinc-500 mt-1">
              {entity.displayName} · elegí el mes, cargá comprobantes y después exportá a ARCA
            </p>
          </div>
          <div className="flex flex-wrap gap-3 items-center text-sm">
            <Link
              href="/admin/facturacion"
              className="rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 font-medium hover:border-emerald-500/50"
            >
              Facturación
            </Link>
            <Link href="/" className="text-emerald-600 hover:text-emerald-700 font-medium px-1">
              ← Dashboard
            </Link>
          </div>
        </header>

        <div className="sticky top-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 mb-6 bg-zinc-100/90 dark:bg-zinc-900/90 backdrop-blur-md border-b border-zinc-200/80 dark:border-zinc-700/80 space-y-3">
          <div className="flex flex-wrap gap-3 items-end justify-between">
            <div className="flex flex-wrap gap-3 items-end">
            <label className="flex flex-col gap-0.5 text-xs">
              <span className="font-medium text-zinc-500 uppercase tracking-wide">Contabilidad de</span>
              <select
                value={entityId}
                onChange={(e) => setEntityId(e.target.value as AccountingEntityId)}
                className="rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm min-w-[12rem] font-medium"
              >
                {ACCOUNTING_ENTITY_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-0.5 text-xs">
              <span className="font-medium text-zinc-500 uppercase tracking-wide">Mes a trabajar</span>
              <div className="flex gap-2">
                <select
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm min-w-[9rem] font-medium"
                >
                  {MONTHS.map((m) => (
                    <option key={m.v} value={m.v}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={2020}
                  max={2099}
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  className="rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm w-24 font-medium"
                />
              </div>
            </label>
            </div>
            {loading ? (
              <span className="text-xs text-zinc-500 pb-2">Actualizando…</span>
            ) : (
              <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 pb-1.5">
                {periodLabel(month, year)}
              </span>
            )}
            {error ? <p className="text-xs text-red-600 dark:text-red-400 max-w-md pb-2">{error}</p> : null}
          </div>
          <ContabTabBar
            tab={tab}
            setTab={(t) => {
              setError(null);
              setTab(t);
            }}
            counts={tabCounts}
            isIndividual={entity.isIndividual}
          />
        </div>

        {tab === "panel" && (
          <div className="space-y-6">
            {resumen ? (
              <ResumenBlock
                data={resumen}
                moneyFn={money}
                periodLabel={periodLabel(month, year)}
                onGoTab={setTab}
              />
            ) : loading ? (
              <p className="text-sm text-zinc-500">Cargando resumen…</p>
            ) : null}
          </div>
        )}
        {tab === "cobros" && (
          <CobrosTab
            authHeader={authHeader}
            cobros={cobros}
            facturas={facturas}
            onRefresh={loadLists}
            qh={qh}
            entityId={entityId}
            entityQs={entityQs}
          />
        )}
        {tab === "pagos" && (
          <PagosTab
            authHeader={authHeader}
            pagos={pagos}
            onRefresh={loadLists}
            qh={qh}
            entityId={entityId}
            entityQs={entityQs}
            companyLabel={entity.displayName}
            companyCuit={entity.cuit}
          />
        )}
        {tab === "facturas" && (
          <FacturasTab
            authHeader={authHeader}
            facturas={facturas}
            onRefresh={loadLists}
            qh={qh}
            entityId={entityId}
            entityQs={entityQs}
          />
        )}
        {tab === "importar" && (
          <ImportarTab
            authHeader={authHeader}
            onDone={refreshAll}
            onGoTab={setTab}
            year={year}
            month={month}
            entityId={entityId}
            entityQs={entityQs}
            integrations={entity.integrations}
          />
        )}
        {tab === "arca" && (
          <ArcaTab
            month={month}
            year={year}
            entityId={entityId}
            isIndividual={entity.isIndividual}
            authHeader={authHeader}
            exporting={exportingZip}
            exportingCm05={exportingCm05}
            onDownloadArchivo={(id) => void descargaArcaArchivoWrapped(id)}
            onDownloadTodos={() => void descargaArcaTodos()}
            onDownloadCm05={() => void descargaCm05()}
            solicitarAlertasEscritorio={solicitarAlertasEscritorio}
            ultimoDigitoInput={ultimoDigitoInput}
            setUltimoDigitoInput={setUltimoDigitoInput}
            cuitCompletoOpcional={cuitCompletoOpcional}
            setCuitCompletoOpcional={setCuitCompletoOpcional}
            loadLibroVencimientos={loadLibroVencimientos}
            libroAviso={libroAviso}
            libroItems={libroItems}
          />
        )}
        {tab === "auditoria" && (
          <AuditoriaIvaTab
            authHeader={authHeader}
            year={year}
            month={month}
            qh={qh}
            entityId={entityId}
          />
        )}
        {tab === "ganancias" && (
          <GananciasTab
            authHeader={authHeader}
            year={year}
            month={month}
            entityId={entityId}
            entityQs={entityQs}
            isIndividual={entity.isIndividual}
          />
        )}
        {tab === "bienes" && entity.isIndividual && (
          <BienesPersonalesTab
            authHeader={authHeader}
            year={year}
            entityId={entityId}
            entityQs={entityQs}
          />
        )}
      </div>
    </div>
  );
}

function MercadoPagoImportCard(props: {
  authHeader: HeadersInit;
  onDone: () => Promise<void>;
  year: string;
  month: string;
  entityId: AccountingEntityId;
  step: number;
}) {
  const { authHeader, onDone, year, month, entityId, step } = props;
  const [mpSyncing, setMpSyncing] = useState(false);
  const [mpRange, setMpRange] = useState(() => monthDateRange(year, month));

  useEffect(() => {
    setMpRange(monthDateRange(year, month));
  }, [year, month]);

  const syncMercadoPago = async () => {
    setMpSyncing(true);
    try {
      const body =
        mpRange.begin.trim() && mpRange.end.trim()
          ? { begin: mpRange.begin.trim(), end: mpRange.end.trim(), entity: entityId }
          : { entity: entityId };
      const res = await fetch("/api/accounting/mercadopago/sync-cobros", {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        alert(String(j.error ?? "Error sincronizando Mercado Pago"));
        return;
      }
      alert(
        `Mercado Pago: ${Number(j.imported ?? 0)} cobros nuevos · ${Number(j.skippedDuplicates ?? 0)} ya existían.`
      );
      await onDone();
    } finally {
      setMpSyncing(false);
    }
  };

  return (
    <div className="rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 p-6 shadow-sm">
      <span className="inline-flex items-center gap-1.5 mb-1">
        <span className="w-5 h-5 rounded-full bg-sky-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">{step}</span>
        <p className="text-xs font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">Mercado Pago · Cobros online</p>
      </span>
      <h3 className="font-semibold text-sky-900 dark:text-sky-100 mb-1 mt-1">Sincronizar cobros</h3>
      <p className="text-sm text-sky-800 dark:text-sky-200 mb-4">
        Se conecta directo a MP y trae los cobros aprobados del mes. No hay nada que bajar. Ajustá las fechas si necesitás un rango distinto.
      </p>
      <div className="flex flex-wrap gap-4 items-end">
        <label className="flex flex-col gap-1 text-sm">
          Desde
          <input
            type="date"
            value={mpRange.begin}
            onChange={(e) => setMpRange((s) => ({ ...s, begin: e.target.value }))}
            className="rounded-lg border px-3 py-2 bg-white dark:bg-zinc-800 border-sky-300"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Hasta
          <input
            type="date"
            value={mpRange.end}
            onChange={(e) => setMpRange((s) => ({ ...s, end: e.target.value }))}
            className="rounded-lg border px-3 py-2 bg-white dark:bg-zinc-800 border-sky-300"
          />
        </label>
        <button
          type="button"
          disabled={mpSyncing || !mpRange.begin || !mpRange.end}
          onClick={() => void syncMercadoPago()}
          className="rounded-lg bg-sky-600 text-white px-5 py-2 font-medium hover:bg-sky-700 disabled:opacity-50"
        >
          {mpSyncing ? "Sincronizando…" : "Sincronizar cobros"}
        </button>
      </div>
    </div>
  );
}

function monthDateRange(year: string, month: string): { begin: string; end: string } {
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return { begin: "", end: "" };
  }
  const begin = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { begin, end };
}

function ImportarTab(props: {
  authHeader: HeadersInit;
  onDone: () => Promise<void>;
  onGoTab: (t: TabId) => void;
  year: string;
  month: string;
  entityId: AccountingEntityId;
  entityQs: () => string;
  integrations: AccountingEntity["integrations"];
}) {
  const { authHeader, onDone, onGoTab, year, month, entityId, entityQs, integrations } = props;
  const monthName = MONTHS.find((m) => m.v === month)?.label ?? month;
  const period = `${month.padStart(2, "0")}/${year}`;

  let stepNum = 0;
  const nextStep = () => {
    stepNum += 1;
    return stepNum;
  };

  return (
    <div className="space-y-5">
      <TabPageIntro
        title={`Cierre de ${monthName} ${year}`}
        description="Seguí los pasos en orden. Cada uno trae datos de un portal distinto. Al final todo queda cargado para generar las declaraciones."
      />

      {/* Guía rápida visual */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50 p-4">
        <p className="text-xs font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-3">
          ¿Qué hay que hacer este mes?
        </p>
        <ol className="space-y-2 text-sm">
          {integrations.afipSyncVentas ? (
            <li className="flex gap-2">
              <span className="shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center">1</span>
              <span><strong>Ventas:</strong> clic en "Sync ventas electrónicas" acá abajo — se conecta solo a AFIP.</span>
            </li>
          ) : (
            <li className="flex gap-2">
              <span className="shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center">1</span>
              <span>
                <strong>Ventas:</strong>{" "}
                <a href="https://auth.afip.gob.ar" target="_blank" rel="noreferrer" className="underline text-blue-600 dark:text-blue-400">auth.afip.gob.ar</a>
                {" "}→ Mis Comprobantes → <em>Emitidos</em> → filtrá {monthName} → Exportar Excel → subilo acá abajo.
              </span>
            </li>
          )}
          <li className="flex gap-2">
            <span className="shrink-0 w-5 h-5 rounded-full bg-amber-600 text-white text-[10px] font-bold flex items-center justify-center">2</span>
            <span>
              <strong>Gastos:</strong>{" "}
              <a href="https://auth.afip.gob.ar" target="_blank" rel="noreferrer" className="underline text-amber-600 dark:text-amber-400">auth.afip.gob.ar</a>
              {" "}→ Mis Comprobantes → <em>Recibidos</em> → filtrá {monthName} → Exportar Excel → subilo acá abajo.
            </span>
          </li>
          {integrations.bankIngest ? (
            <li className="flex gap-2">
              <span className="shrink-0 w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center">3</span>
              <span>
                <strong>Banco:</strong>{" "}
                <a href="https://www.macro.com.ar" target="_blank" rel="noreferrer" className="underline text-indigo-600 dark:text-indigo-400">macro.com.ar</a>
                {" "}→ Banca Empresas → Cuenta corriente → Movimientos → filtrá {monthName} → descargar PDF del extracto → subilo acá abajo.
              </span>
            </li>
          ) : null}
          {integrations.mercadoPago ? (
            <li className="flex gap-2">
              <span className="shrink-0 w-5 h-5 rounded-full bg-sky-600 text-white text-[10px] font-bold flex items-center justify-center">{integrations.bankIngest ? "4" : "3"}</span>
              <span><strong>Mercado Pago:</strong> clic en "Sincronizar cobros" acá abajo — se conecta solo.</span>
            </li>
          ) : null}
          <li className="flex gap-2">
            <span className="shrink-0 w-5 h-5 rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center">✓</span>
            <span><strong>Listo.</strong> Revisá en "Resumen" que los números cierren y después andá a "Declarar" para exportar a ARCA.</span>
          </li>
        </ol>
      </div>

      <ol className="grid gap-4">
        <li>
          <ArcaSyncCard
            authHeader={authHeader}
            onDone={onDone}
            year={year}
            month={month}
            entityId={entityId}
            entityQs={entityQs}
            afipSyncVentas={integrations.afipSyncVentas}
            stepVentas={nextStep()}
            stepGastos={nextStep()}
          />
        </li>
        {integrations.bankIngest ? (
          <li>
            <BankExtractCard
              authHeader={authHeader}
              onDone={onDone}
              entityId={entityId}
              entityQs={entityQs}
              step={nextStep()}
            />
          </li>
        ) : null}
        {integrations.mercadoPago ? (
          <li>
            <MercadoPagoImportCard
              authHeader={authHeader}
              onDone={onDone}
              year={year}
              month={month}
              entityId={entityId}
              step={nextStep()}
            />
          </li>
        ) : null}
        <li className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-600 p-4">
          <p className="text-sm font-medium mb-1">¿Falta algún comprobante suelto?</p>
          <p className="text-xs text-zinc-500 mb-3">
            Si hay una factura o gasto que no aparece en Mis Comprobantes (ej: ticket en papel, servicio sin CAE), cargalo con IA desde PDF o a mano.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onGoTab("facturas")}
              className="rounded-lg border px-3 py-2 text-sm hover:border-emerald-500/50"
            >
              Ir a Facturas
            </button>
            <button
              type="button"
              onClick={() => onGoTab("pagos")}
              className="rounded-lg border px-3 py-2 text-sm hover:border-emerald-500/50"
            >
              Ir a Gastos
            </button>
          </div>
        </li>
      </ol>
    </div>
  );
}

function ArcaSyncCard(props: {
  authHeader: HeadersInit;
  onDone: () => Promise<void>;
  year: string;
  month: string;
  entityId: AccountingEntityId;
  entityQs: () => string;
  afipSyncVentas: boolean;
  stepVentas: number;
  stepGastos: number;
}) {
  const { authHeader, onDone, year, month, entityId, entityQs, afipSyncVentas, stepVentas, stepGastos } = props;
  const period = `${month.padStart(2, "0")}/${year}`;
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState("");
  const [preview, setPreview] = useState<
    | {
        kind: string;
        total: number;
        warnings: string[];
        rows: {
          kind: string;
          fecha: string;
          tipo: number;
          pv: string;
          numero: string;
          contraparte: string;
          total: number;
        }[];
        file: File;
      }
    | null
  >(null);

  const syncVentas = async () => {
    setSyncing(true);
    setMsg("");
    try {
      const res = await fetch("/api/accounting/afip/sync-ventas", {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ year: Number(year), month: Number(month), entity: entityId }),
      });
      const j = (await res.json()) as {
        error?: string;
        imported?: number;
        consulted?: number;
        skippedDuplicates?: number;
        skippedNoFecha?: number;
        skippedConsultError?: number;
        errors?: string[];
        diagnostics?: string[];
        ptoVtas?: number[];
      };
      if (!res.ok) {
        setMsg(j.error ?? j.errors?.[0] ?? "No se pudo sincronizar ventas AFIP");
        return;
      }
      const parts = [
        `${j.imported ?? 0} ventas nuevas`,
        `${j.skippedDuplicates ?? 0} ya estaban`,
        `${j.consulted ?? 0} consultas`,
      ];
      if (j.ptoVtas?.length) parts.push(`PV ${j.ptoVtas.join(",")}`);
      let text = parts.join(" · ");
      if (j.diagnostics?.length) text += `\n${j.diagnostics.slice(0, 4).join(" · ")}`;
      if (j.errors?.length) text += `\n${j.errors.slice(0, 2).join(" · ")}`;
      setMsg(text);
      await onDone();
    } finally {
      setSyncing(false);
    }
  };

  const onFile = async (file: File | null) => {
    if (!file) return;
    setImporting(true);
    setMsg("");
    setPreview(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("dryRun", "1");
      fd.append("entity", entityId);
      const res = await fetch(`/api/accounting/mis-comprobantes/import?${entityQs()}`, {
        method: "POST",
        headers: authHeader,
        body: fd,
      });
      const j = (await res.json()) as {
        error?: string;
        kind?: string;
        total?: number;
        warnings?: string[];
        preview?: {
          kind: string;
          fecha: string;
          tipo: number;
          pv: string;
          numero: string;
          contraparte: string;
          total: number;
        }[];
      };
      if (!res.ok) {
        setMsg(j.error ?? "No se pudo leer el archivo");
        return;
      }
      setPreview({
        kind: j.kind ?? "recibido",
        total: j.total ?? 0,
        warnings: j.warnings ?? [],
        rows: j.preview ?? [],
        file,
      });
    } finally {
      setImporting(false);
    }
  };

  const confirmImport = async () => {
    if (!preview) return;
    setImporting(true);
    setMsg("");
    try {
      const fd = new FormData();
      fd.set("file", preview.file);
      fd.append("entity", entityId);
      const res = await fetch(`/api/accounting/mis-comprobantes/import?${entityQs()}`, {
        method: "POST",
        headers: authHeader,
        body: fd,
      });
      const j = (await res.json()) as {
        error?: string;
        importedPagos?: number;
        importedFacturas?: number;
        skippedDuplicates?: number;
      };
      if (!res.ok) {
        setMsg(j.error ?? "Error al importar");
        return;
      }
      setMsg(
        `Listo: ${j.importedFacturas ?? 0} ventas · ${j.importedPagos ?? 0} gastos · ${j.skippedDuplicates ?? 0} duplicados omitidos.`
      );
      setPreview(null);
      await onDone();
    } finally {
      setImporting(false);
    }
  };

  const fileLabel = importing ? "Leyendo archivo…" : "Elegir archivo CSV / XLS";

  return (
    <div className="rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-5 shadow-sm space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
          Comprobantes ARCA · {period}
        </p>
        <h3 className="font-semibold text-base mt-1">Ventas y gastos del mes</h3>
        <p className="text-sm text-zinc-500 mt-1">
          Entrá a{" "}
          <a href="https://auth.afip.gob.ar" target="_blank" rel="noreferrer" className="underline text-emerald-700 dark:text-emerald-400">
            auth.afip.gob.ar
          </a>{" "}
          → <strong>Mis Comprobantes</strong> → filtrá el mes → Exportar Excel. Hacelo por separado
          para Emitidos y Recibidos, y subí los dos archivos acá abajo.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-950/20 p-4 space-y-3">
          <div>
            <span className="inline-flex items-center gap-1.5 mb-1">
              <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">{stepVentas}</span>
              <p className="font-medium text-sm text-blue-900 dark:text-blue-100">Ventas (emitidos)</p>
            </span>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              {afipSyncVentas
                ? "Podés sincronizar directo con AFIP (recomendado) o subir el Excel de Emitidos."
                : "ARCA → Mis Comprobantes → pestaña Emitidos → Exportar Excel → subilo acá."}
            </p>
          </div>
          {afipSyncVentas ? (
            <button
              type="button"
              disabled={syncing}
              onClick={() => void syncVentas()}
              className="w-full rounded-lg bg-blue-700 text-white px-3 py-2 text-sm font-medium hover:bg-blue-800 disabled:opacity-50"
            >
              {syncing ? "Consultando AFIP…" : "Sync ventas electrónicas"}
            </button>
          ) : null}
          <label className="block w-full text-center rounded-lg border border-blue-300 dark:border-blue-700 bg-white/80 dark:bg-zinc-900/40 px-3 py-2 text-sm cursor-pointer hover:bg-white dark:hover:bg-zinc-800">
            {fileLabel}
            <input
              type="file"
              accept=".csv,.xls,.xlsx,.txt"
              className="hidden"
              disabled={importing}
              onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <p className="text-[11px] text-zinc-500">Nombre típico: <em>Mis Comprobantes Emitidos - CUIT….xlsx</em></p>
        </div>

        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20 p-4 space-y-3">
          <div>
            <span className="inline-flex items-center gap-1.5 mb-1">
              <span className="w-5 h-5 rounded-full bg-amber-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">{stepGastos}</span>
              <p className="font-medium text-sm text-amber-900 dark:text-amber-100">Gastos (recibidos)</p>
            </span>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              ARCA → Mis Comprobantes → pestaña <strong>Recibidos</strong> → filtrá el mes → Exportar Excel → subilo acá.
            </p>
          </div>
          <label className="block w-full text-center rounded-lg bg-amber-700 text-white px-3 py-2 text-sm font-medium cursor-pointer hover:bg-amber-800">
            {importing ? "Leyendo archivo…" : "Subir recibidos"}
            <input
              type="file"
              accept=".csv,.xls,.xlsx,.txt"
              className="hidden"
              disabled={importing}
              onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <p className="text-[11px] text-zinc-500">Nombre típico: <em>Mis Comprobantes Recibidos - CUIT….xlsx</em></p>
        </div>
      </div>

      {msg ? (
        <p className="text-sm rounded-lg bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-700 p-3 whitespace-pre-line">
          {msg}
        </p>
      ) : null}

      {preview ? (
        <div className="space-y-3 border-t border-zinc-200 dark:border-zinc-600 pt-4">
          <p className="text-sm font-medium">
            Revisá antes de confirmar ·{" "}
            <span className="text-emerald-700 dark:text-emerald-400">
              {preview.kind === "emitido" ? "ventas" : "gastos"}
            </span>{" "}
            · {preview.total} comprobantes
          </p>
          {preview.warnings.length > 0 ? (
            <ul className="text-xs text-amber-700 list-disc pl-4">
              {preview.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
          <div className="max-h-48 overflow-auto text-xs">
            <table className="w-full">
              <thead>
                <tr className="text-left text-zinc-500">
                  <th className="py-1 pr-2">Fecha</th>
                  <th className="py-1 pr-2">Tipo</th>
                  <th className="py-1 pr-2">PV-N°</th>
                  <th className="py-1 pr-2">Contraparte</th>
                  <th className="py-1 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r, i) => (
                  <tr key={i} className="border-t border-zinc-100 dark:border-zinc-700">
                    <td className="py-1 pr-2">{r.fecha}</td>
                    <td className="py-1 pr-2">{r.tipo}</td>
                    <td className="py-1 pr-2">
                      {r.pv}-{r.numero}
                    </td>
                    <td className="py-1 pr-2 truncate max-w-[12rem]">{r.contraparte}</td>
                    <td className="py-1 text-right">
                      {r.total.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={importing}
              onClick={() => void confirmImport()}
              className="rounded-lg bg-emerald-700 text-white px-4 py-2 text-sm font-medium hover:bg-emerald-800 disabled:opacity-50"
            >
              {importing ? "Importando…" : "Confirmar e importar"}
            </button>
            <button
              type="button"
              disabled={importing}
              onClick={() => setPreview(null)}
              className="rounded-lg border px-4 py-2 text-sm"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ResumenBlock({
  data,
  moneyFn,
  periodLabel: periodTitle,
  onGoTab,
}: {
  data: Record<string, unknown>;
  moneyFn: (n: number) => string;
  periodLabel: string;
  onGoTab: (t: TabId) => void;
}) {
  const iva = data.iva as Record<string, unknown> | undefined;
  const deb = (iva?.debitoVentas as Record<string, number>) ?? {};
  const cred = (iva?.creditoCompras as Record<string, number>) ?? {};
  const tesoreria = data.tesoreria as Record<string, number> | undefined;
  const avisoLegal = typeof data.avisoLegal === "string" ? data.avisoLegal : "";
  const diffIva = Number(iva?.diferenciaIVAOrientativa) || 0;

  return (
    <div className="space-y-6">
      <TabPageIntro
        title={periodTitle}
        description="Vista rápida del mes. Cargá datos primero; al final exportá en Declarar."
      />

      <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 p-4">
        <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100 mb-3">
          Orden sugerido del mes
        </p>
        <div className="grid sm:grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => onGoTab("importar")}
            className="rounded-lg bg-white dark:bg-zinc-900 border border-emerald-200 dark:border-emerald-800 px-3 py-3 text-left hover:border-emerald-500"
          >
            <span className="text-[10px] font-bold text-emerald-700">1</span>
            <p className="text-sm font-medium">Cargar datos</p>
            <p className="text-xs text-zinc-500">ARCA, banco, MP</p>
          </button>
          <button
            type="button"
            onClick={() => onGoTab("facturas")}
            className="rounded-lg bg-white dark:bg-zinc-900 border border-emerald-200 dark:border-emerald-800 px-3 py-3 text-left hover:border-emerald-500"
          >
            <span className="text-[10px] font-bold text-emerald-700">2</span>
            <p className="text-sm font-medium">Revisar facturas</p>
            <p className="text-xs text-zinc-500">Compras y ventas</p>
          </button>
          <button
            type="button"
            onClick={() => onGoTab("arca")}
            className="rounded-lg bg-white dark:bg-zinc-900 border border-emerald-200 dark:border-emerald-800 px-3 py-3 text-left hover:border-emerald-500"
          >
            <span className="text-[10px] font-bold text-emerald-700">3</span>
            <p className="text-sm font-medium">Declarar</p>
            <p className="text-xs text-zinc-500">Exportar a ARCA</p>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-4 shadow-sm">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">IVA orientativo</p>
          <p className="text-lg font-bold mt-1 text-amber-700 dark:text-amber-400">{moneyFn(diffIva)}</p>
        </div>
        <div className="rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-4 shadow-sm">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Caja (cobros − gastos)</p>
          <p className="text-lg font-bold mt-1">{moneyFn(tesoreria?.resultadoCajaOrientativo ?? 0)}</p>
        </div>
        <div className="rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-4 shadow-sm">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Facturas</p>
          <p className="text-lg font-bold mt-1">{Number(data.libroFacturasCargadas) || 0}</p>
        </div>
        <div className="rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-4 shadow-sm">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Cobros / Gastos</p>
          <p className="text-sm font-bold mt-1">
            {Number(data.cobrosRegistrados) || 0} / {Number(data.pagosRegistrados) || 0}
          </p>
        </div>
      </div>
      <p className="text-sm rounded-lg bg-amber-500/15 border border-amber-600/40 text-amber-950 dark:text-amber-100 p-4">
        {avisoLegal}
      </p>
      <div className="rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-6 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">Detalle IVA — facturas del período</h2>
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <h3 className="font-medium text-emerald-700 dark:text-emerald-400 mb-2">IVA orientativo — débito (ventas)</h3>
            <ul className="text-sm space-y-1 text-zinc-600 dark:text-zinc-400">
              <li>Neto gravado acum.: {moneyFn(deb.netoGravado ?? 0)}</li>
              <li>IVA: {moneyFn(deb.iva ?? 0)}</li>
              <li>Total facturación: {moneyFn(deb.totalFacturado ?? 0)}</li>
            </ul>
          </div>
          <div>
            <h3 className="font-medium text-blue-700 dark:text-blue-400 mb-2">IVA orientativo — crédito (compras)</h3>
            <ul className="text-sm space-y-1 text-zinc-600 dark:text-zinc-400">
              <li>Neto gravado acum.: {moneyFn(cred.netoGravado ?? 0)}</li>
              <li>IVA: {moneyFn(cred.iva ?? 0)}</li>
              <li>Total compras registradas: {moneyFn(cred.totalFacturado ?? 0)}</li>
            </ul>
          </div>
        </div>
        <p className="mt-4 text-lg font-semibold text-zinc-800 dark:text-zinc-100">
          Diferencia IVA orientativa (débito − crédito):{" "}
          {moneyFn(Number(iva?.diferenciaIVAOrientativa) || 0)}
        </p>
      </div>
      <div className="rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-6 shadow-sm">
        <h3 className="font-medium mb-4">Flujo de caja registrado</h3>
        <div className="grid sm:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-zinc-500">Cobros</p>
            <p className="text-xl font-bold text-emerald-600">{moneyFn(tesoreria?.cobrosTotales ?? 0)}</p>
          </div>
          <div>
            <p className="text-zinc-500">Pagos</p>
            <p className="text-xl font-bold text-orange-600">{moneyFn(tesoreria?.pagosTotales ?? 0)}</p>
          </div>
          <div>
            <p className="text-zinc-500">Resultado cobros − pagos (orientativo)</p>
            <p className="text-xl font-bold">{moneyFn(tesoreria?.resultadoCajaOrientativo ?? 0)}</p>
          </div>
        </div>
        <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
          Ganancia impositiva y contable dependen de otros ajustes; esto sólo ordena tus movimientos cargados aquí.
        </p>
      </div>
    </div>
  );
}

type BankPreviewRow = {
  bankReference: string;
  kind: "cobro" | "pago";
  fecha: string;
  importe: number;
  concepto: string;
  medio: string;
  referenciaBanco: string;
  observaciones: string;
  duplicate: boolean;
  existingKind?: string;
  selected: boolean;
  vepHint?: { isVep: true; taxSubcategory: string; isIncomeTaxDeductible: boolean } | null;
};

function BankExtractCard(props: {
  authHeader: HeadersInit;
  onDone: () => Promise<void>;
  entityId: AccountingEntityId;
  entityQs: () => string;
  step: number;
}) {
  const { authHeader, onDone, entityId, entityQs, step } = props;
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [drag, setDrag] = useState(false);
  const [pdfStoragePath, setPdfStoragePath] = useState("");
  const [cuentaNumero, setCuentaNumero] = useState("");
  const [rows, setRows] = useState<BankPreviewRow[]>([]);

  const processFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      alert("Solo archivos PDF.");
      return;
    }
    const fd = new FormData();
    fd.append("pdf", file);
    fd.append("entity", entityId);
    setBusy(true);
    try {
      const res = await fetch(`/api/accounting/bank-ingest?${entityQs()}`, {
        method: "POST",
        headers: authHeader,
        body: fd,
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        movimientos?: BankPreviewRow[];
        pdfStoragePath?: string;
        cuentaNumero?: string;
      };
      if (!res.ok) {
        alert(typeof j.error === "string" ? j.error : `Error HTTP ${res.status}`);
        return;
      }
      setPdfStoragePath(String(j.pdfStoragePath ?? ""));
      setCuentaNumero(String(j.cuentaNumero ?? ""));
      setRows(
        (j.movimientos ?? []).map((m) => ({
          ...m,
          selected: m.duplicate ? false : m.selected !== false,
        }))
      );
    } finally {
      setBusy(false);
    }
  };

  const toggleRow = (idx: number) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, selected: !r.selected } : r)));
  };

  const confirmImport = async () => {
    const selected = rows.filter((r) => r.selected);
    if (selected.length === 0) {
      alert("Seleccioná al menos un movimiento.");
      return;
    }
    setConfirming(true);
    try {
      const res = await fetch("/api/accounting/bank-ingest/confirm", {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          entity: entityId,
          pdfStoragePath: pdfStoragePath || undefined,
          movements: selected,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        alert(String(j.error ?? "Error al importar"));
        return;
      }
      const cob = Number(j.importedCobros ?? 0);
      const pag = Number(j.importedPagos ?? 0);
      const skip = Number(j.skippedDuplicates ?? 0);
      alert(
        `Importado: ${cob} cobro(s), ${pag} pago(s).` +
          (skip ? ` ${skip} omitido(s) por duplicado.` : "")
      );
      setRows([]);
      setPdfStoragePath("");
      await onDone();
    } finally {
      setConfirming(false);
    }
  };

  const selectedCount = rows.filter((r) => r.selected).length;

  return (
    <div
      className={`rounded-xl border-2 border-dashed p-6 transition-colors ${
        drag
          ? "border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30"
          : "border-zinc-300 dark:border-zinc-600"
      } bg-white dark:bg-zinc-800 shadow-sm`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void processFile(f);
      }}
    >
      <span className="inline-flex items-center gap-1.5 mb-1">
        <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">{step}</span>
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">Banco · Extracto del mes</p>
      </span>
      <h3 className="font-medium text-zinc-800 dark:text-zinc-100 mb-1">
        Movimientos bancarios (PDF)
      </h3>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
        <a href="https://www.macro.com.ar" target="_blank" rel="noreferrer" className="underline text-indigo-600 dark:text-indigo-400">macro.com.ar</a>
        {" "}→ Banca Empresas → Cuenta corriente → Movimientos → filtrá el mes → descargar PDF del extracto → subilo acá. La IA lo lee y te muestra una tabla para revisar antes de confirmar.
      </p>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="file"
          accept="application/pdf,.pdf"
          disabled={busy || confirming}
          className="text-sm max-w-full"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void processFile(f);
            e.target.value = "";
          }}
        />
        {busy ? (
          <span className="text-sm text-indigo-600 dark:text-indigo-400">Leyendo extracto…</span>
        ) : null}
        {cuentaNumero ? (
          <span className="text-xs font-mono text-zinc-500">Cuenta {cuentaNumero}</span>
        ) : null}
      </div>

      {rows.length > 0 ? (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b bg-zinc-50 dark:bg-zinc-900/60">
                  <th className="py-2 px-2 w-10"></th>
                  <th className="text-left py-2 px-2">Fecha</th>
                  <th className="text-left py-2 px-2">Tipo</th>
                  <th className="text-left py-2 px-2">Concepto</th>
                  <th className="text-right py-2 px-2">Importe</th>
                  <th className="text-left py-2 px-2">Ref.</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr
                    key={row.bankReference}
                    className={`border-b border-zinc-100 dark:border-zinc-700/50 ${
                      row.duplicate ? "opacity-60" : ""
                    }`}
                  >
                    <td className="py-2 px-2">
                      <input
                        type="checkbox"
                        checked={row.selected}
                        disabled={row.duplicate}
                        onChange={() => toggleRow(idx)}
                      />
                    </td>
                    <td className="py-2 px-2 font-mono text-xs">{row.fecha}</td>
                    <td className="py-2 px-2">
                      <span
                        className={
                          row.kind === "cobro"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-orange-600 dark:text-orange-400"
                        }
                      >
                        {row.kind}
                      </span>
                      {row.vepHint ? (
                        <span className="ml-1.5 inline-block rounded px-1 py-0.5 text-[10px] font-bold bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">
                          VEP
                        </span>
                      ) : null}
                      {row.duplicate ? (
                        <span className="ml-1 text-[10px] text-zinc-500">(ya cargado)</span>
                      ) : null}
                    </td>
                    <td className="py-2 px-2 max-w-[240px]" title={row.concepto}>
                      <span className="truncate block">{row.concepto}</span>
                      {row.vepHint ? (
                        <span className="text-[10px] text-violet-600 dark:text-violet-400">
                          → {row.vepHint.taxSubcategory.replace(/_/g, " ")} · {row.vepHint.isIncomeTaxDeductible ? "deducible Ganancias" : "no deducible"}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 px-2 text-right font-medium">{money(row.importe)}</td>
                    <td className="py-2 px-2 font-mono text-xs">{row.referenciaBanco}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            <button
              type="button"
              disabled={confirming || selectedCount === 0}
              onClick={() => void confirmImport()}
              className="rounded-lg bg-indigo-600 text-white px-5 py-2 font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {confirming
                ? "Importando…"
                : `Confirmar importación (${selectedCount} movimiento${selectedCount === 1 ? "" : "s"})`}
            </button>
            <button
              type="button"
              className="rounded-lg border px-4 py-2 text-sm"
              onClick={() => {
                setRows([]);
                setPdfStoragePath("");
              }}
            >
              Descartar vista previa
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AccountingPdfAiCard(props: {
  authHeader: HeadersInit;
  mode: "factura" | "pago";
  onDone: () => Promise<void>;
  onPagoExtracted?: (extracted: Record<string, unknown>, receiverCuit?: string | null) => void;
  entityId: AccountingEntityId;
  entityQs: () => string;
}) {
  const { authHeader, mode, onDone, onPagoExtracted, entityId, entityQs } = props;
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [tipoLibro, setTipoLibro] = useState<"venta" | "compra">("venta");

  const sendFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      alert("Solo archivos PDF.");
      return;
    }

    const fd = new FormData();
    fd.append("pdf", file);
    fd.append("tipo", mode === "factura" ? "factura" : "pago");
    fd.append("entity", entityId);
    if (mode === "factura") fd.append("tipoLibro", tipoLibro);
    if (mode === "pago") fd.append("autoSave", "false");

    setBusy(true);
    try {
      const res = await fetch(`/api/accounting/pdf-ingest?${entityQs()}`, {
        method: "POST",
        headers: authHeader,
        body: fd,
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        kind?: string;
        extracted?: Record<string, unknown>;
        receiverCuit?: string;
      };
      if (!res.ok) {
        alert(typeof j?.error === "string" ? j.error : `Error HTTP ${res.status}`);
        return;
      }
      if (mode === "pago" && j.kind === "pago_preview" && j.extracted && onPagoExtracted) {
        onPagoExtracted(j.extracted, j.receiverCuit ?? null);
        alert("PDF analizado. Revisá y guardá el formulario de gasto.");
        return;
      }
      await onDone();
      alert(mode === "factura" ? "Factura creada desde el PDF." : "Pago (gasto) creado desde el PDF.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`rounded-xl border-2 border-dashed p-6 transition-colors ${
        drag
          ? "border-violet-500 bg-violet-50/50 dark:bg-violet-950/30"
          : "border-zinc-300 dark:border-zinc-600"
      } bg-white dark:bg-zinc-800 shadow-sm`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void sendFile(f);
      }}
    >
      <h3 className="font-medium text-zinc-800 dark:text-zinc-100 mb-1">PDF + IA → base de datos</h3>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
        {mode === "pago"
          ? "El PDF se sube a Storage; Gemini extrae datos fiscales y completa el formulario para revisión manual antes de guardar."
          : "El archivo se sube a Firebase Storage; Google AI (Gemini) lee el PDF y genera el registro en Firestore."}
      </p>
      {mode === "factura" ? (
        <label className="flex flex-col gap-1 text-sm mb-4 max-w-xs">
          <span>Clasificación libro</span>
          <select
            value={tipoLibro}
            onChange={(e) => setTipoLibro(e.target.value as "venta" | "compra")}
            disabled={busy}
            className="rounded-lg border px-3 py-2 bg-white dark:bg-zinc-700 border-zinc-300 dark:border-zinc-600"
          >
            <option value="venta">Venta emitida (IVA débito)</option>
            <option value="compra">Compra registrada (IVA crédito)</option>
          </select>
        </label>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept="application/pdf,.pdf"
          disabled={busy}
          className="text-sm max-w-full"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void sendFile(f);
            e.target.value = "";
          }}
        />
        {busy ? <span className="text-sm text-violet-600 dark:text-violet-400">Procesando…</span> : null}
      </div>
    </div>
  );
}

function FacturasTab(props: {
  authHeader: HeadersInit;
  facturas: Record<string, unknown>[];
  onRefresh: () => Promise<void>;
  qh: () => string;
  entityId: AccountingEntityId;
  entityQs: () => string;
}) {
  const { authHeader, facturas, onRefresh, qh, entityId, entityQs } = props;

  type FormState = {
    tipo: string;
    numero: string;
    puntoVenta: string;
    fecha: string;
    razonsocial: string;
    cuit: string;
    tipoComprobante: string;
    netoGravado: string;
    iva: string;
    otrosImpuestos: string;
    total: string;
    observaciones: string;
  };

  const empty: FormState = {
    tipo: "venta",
    numero: "",
    puntoVenta: "",
    fecha: new Date().toISOString().slice(0, 10),
    razonsocial: "",
    cuit: "",
    tipoComprobante: "",
    netoGravado: "",
    iva: "",
    otrosImpuestos: "",
    total: "",
    observaciones: "",
  };

  const [form, setForm] = useState<FormState>(empty);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const parseNum = (s: string) => {
    const n = Number(String(s).replace(",", "."));
    return Number.isFinite(n) ? n : NaN;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const net = parseNum(form.netoGravado);
    const iva = parseNum(form.iva);
    const otros = form.otrosImpuestos.trim() === "" ? 0 : parseNum(form.otrosImpuestos);
    const total = parseNum(form.total);
    if (Number.isNaN(net) || Number.isNaN(iva) || Number.isNaN(total)) return;
    if (Number.isNaN(otros)) return;

    let tipoComprobante: string | undefined = form.tipoComprobante || undefined;
    if (
      tipoComprobante &&
      !["A", "B", "C", "credito_a", "credito_b", "credito_c", "otro"].includes(tipoComprobante)
    ) {
      tipoComprobante = "otro";
    }

    const body = {
      entity: entityId,
      tipo: form.tipo,
      numero: form.numero.trim(),
      puntoVenta: form.puntoVenta.trim() || undefined,
      fecha: form.fecha,
      razonsocial: form.razonsocial.trim(),
      cuit: form.cuit.trim() || undefined,
      tipoComprobante: tipoComprobante === "" ? undefined : tipoComprobante,
      netoGravado: net,
      iva,
      otrosImpuestos: otros,
      total,
      observaciones: form.observaciones.trim() || undefined,
    };

    setSaving(true);
    try {
      const url =
        editId !== null
          ? `/api/accounting/facturas/${editId}?${entityQs()}`
          : "/api/accounting/facturas";
      const method = editId !== null ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(typeof err?.error === "string" ? err.error : "Error");
        return;
      }
      setForm(empty);
      setEditId(null);
      await onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (row: Record<string, unknown>) => {
    const id = String(row.id ?? "");
    setEditId(id);
    setForm({
      tipo: String(row.tipo ?? "venta"),
      numero: String(row.numero ?? ""),
      puntoVenta: String(row.puntoVenta ?? ""),
      fecha: fechaFieldToUi(typeof row.fecha === "string" ? row.fecha : null),
      razonsocial: String(row.razonsocial ?? ""),
      cuit: String(row.cuit ?? ""),
      tipoComprobante: String(row.tipoComprobante ?? ""),
      netoGravado: row.netoGravado != null ? String(row.netoGravado) : "",
      iva: row.iva != null ? String(row.iva) : "",
      otrosImpuestos: row.otrosImpuestos != null ? String(row.otrosImpuestos) : "",
      total: row.total != null ? String(row.total) : "",
      observaciones: String(row.observaciones ?? ""),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const del = async (id: string) => {
    if (!confirm("¿Eliminar esta factura?")) return;
    await fetch(`/api/accounting/facturas/${id}?${entityQs()}`, { method: "DELETE", headers: authHeader });
    await onRefresh();
  };

  return (
    <div className="space-y-6">
      <TabPageIntro
        title="Facturas"
        description="Libro de compras y ventas del mes. Preferí cargarlas desde Cargar datos (Mis Comprobantes). Exportá a ARCA desde Declarar."
      />
      <div className="rounded-xl bg-white dark:bg-zinc-800 border overflow-hidden shadow-sm">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="border-b bg-zinc-50 dark:bg-zinc-900/60">
              <th className="text-left py-3 px-3">Tipo</th>
              <th className="text-left py-3 px-3">Fecha</th>
              <th className="text-left py-3 px-3">Nº / PV</th>
              <th className="text-left py-3 px-3">Contraparte</th>
              <th className="text-right py-3 px-3">Neto</th>
              <th className="text-right py-3 px-3">IVA</th>
              <th className="text-right py-3 px-3">Total</th>
              <th className="text-left py-3 px-3"></th>
            </tr>
          </thead>
          <tbody>
            {facturas.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <EmptyListHint message="No hay facturas en este mes. Cargá con PDF + IA o alta manual." />
                </td>
              </tr>
            ) : (
              facturas.map((row) => {
                const fid = String(row.id ?? "");
                return (
                  <tr key={fid} className="border-b border-zinc-100 dark:border-zinc-700/50">
                    <td className="py-2 px-3">{String(row.tipo)}</td>
                    <td className="py-2 px-3 font-mono text-xs">{fechaFieldToUi(String(row.fecha ?? ""))}</td>
                    <td className="py-2 px-3 font-mono text-xs">
                      {String(row.puntoVenta ?? "")}-{String(row.numero ?? "")}
                    </td>
                    <td className="py-2 px-3 max-w-[200px] truncate" title={String(row.razonsocial ?? "")}>
                      {String(row.razonsocial ?? "")}
                    </td>
                    <td className="py-2 px-3 text-right">{money(Number(row.netoGravado) || 0)}</td>
                    <td className="py-2 px-3 text-right">{money(Number(row.iva) || 0)}</td>
                    <td className="py-2 px-3 text-right">{money(Number(row.total) || 0)}</td>
                    <td className="py-2 px-3 space-x-2">
                      <button type="button" className="text-emerald-600 hover:underline" onClick={() => startEdit(row)}>
                        Editar
                      </button>
                      <button type="button" className="text-red-600 hover:underline" onClick={() => del(fid)}>
                        Eliminar
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        <p className="text-xs text-zinc-500 p-4">Filtrado: {qh()}</p>
      </div>
      <CollapsibleSection title="PDF + IA (factura o comprobante)" subtitle="Clasificá venta o compra" defaultOpen={false}>
        <div className="pt-4">
          <AccountingPdfAiCard
            authHeader={authHeader}
            mode="factura"
            onDone={onRefresh}
            entityId={entityId}
            entityQs={entityQs}
          />
        </div>
      </CollapsibleSection>
      <CollapsibleSection
        title={editId ? "Editar factura" : "Alta manual"}
        subtitle="Carga campo por campo"
        defaultOpen={Boolean(editId)}
        badge={editId ? "editando" : undefined}
      >
      <form onSubmit={submit} className="grid sm:grid-cols-2 gap-4 pt-4">
        <label className="flex flex-col gap-1 text-sm">
          <span>Tipo libro</span>
          <select
            value={form.tipo}
            onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value }))}
            className="rounded-lg border px-3 py-2 bg-white dark:bg-zinc-700 border-zinc-300 dark:border-zinc-600"
          >
            <option value="venta">Venta emitida — IVA débito</option>
            <option value="compra">Compra registrada — IVA crédito</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Tipo comprobante ARCA</span>
          <select
            value={form.tipoComprobante === "" ? "" : form.tipoComprobante}
            onChange={(e) => setForm((f) => ({ ...f, tipoComprobante: e.target.value }))}
            className="rounded-lg border px-3 py-2 bg-white dark:bg-zinc-700 border-zinc-300 dark:border-zinc-600"
          >
            <option value="">(opcional)</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
            <option value="credito_a">Nota crédito A</option>
            <option value="credito_b">Nota crédito B</option>
            <option value="credito_c">Nota crédito C</option>
            <option value="otro">Otro</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Punto venta
          <input
            value={form.puntoVenta}
            onChange={(e) => setForm((f) => ({ ...f, puntoVenta: e.target.value }))}
            className="rounded-lg border px-3 py-2 bg-white dark:bg-zinc-700 border-zinc-300 dark:border-zinc-600"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Número
          <input
            required
            value={form.numero}
            onChange={(e) => setForm((f) => ({ ...f, numero: e.target.value }))}
            className="rounded-lg border px-3 py-2 bg-white dark:bg-zinc-700 border-zinc-300 dark:border-zinc-600"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Fecha
          <input
            type="date"
            required
            value={form.fecha}
            onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))}
            className="rounded-lg border px-3 py-2 bg-white dark:bg-zinc-700 border-zinc-300 dark:border-zinc-600"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          Razón social cliente / proveedor
          <input
            required
            value={form.razonsocial}
            onChange={(e) => setForm((f) => ({ ...f, razonsocial: e.target.value }))}
            className="rounded-lg border px-3 py-2 bg-white dark:bg-zinc-700 border-zinc-300 dark:border-zinc-600"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          CUIT
          <input
            value={form.cuit}
            onChange={(e) => setForm((f) => ({ ...f, cuit: e.target.value }))}
            className="rounded-lg border px-3 py-2 bg-white dark:bg-zinc-700 border-zinc-300 dark:border-zinc-600"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Neto gravado
          <input
            required
            value={form.netoGravado}
            onChange={(e) => setForm((f) => ({ ...f, netoGravado: e.target.value }))}
            placeholder="ej. 10000"
            className="rounded-lg border px-3 py-2 bg-white dark:bg-zinc-700 border-zinc-300 dark:border-zinc-600"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          IVA
          <input
            required
            value={form.iva}
            onChange={(e) => setForm((f) => ({ ...f, iva: e.target.value }))}
            className="rounded-lg border px-3 py-2 bg-white dark:bg-zinc-700 border-zinc-300 dark:border-zinc-600"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Otros impuestos
          <input
            value={form.otrosImpuestos}
            onChange={(e) => setForm((f) => ({ ...f, otrosImpuestos: e.target.value }))}
            className="rounded-lg border px-3 py-2 bg-white dark:bg-zinc-700 border-zinc-300 dark:border-zinc-600"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Total comprobante
          <input
            required
            value={form.total}
            onChange={(e) => setForm((f) => ({ ...f, total: e.target.value }))}
            className="rounded-lg border px-3 py-2 bg-white dark:bg-zinc-700 border-zinc-300 dark:border-zinc-600"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          Observaciones
          <textarea
            value={form.observaciones}
            onChange={(e) => setForm((f) => ({ ...f, observaciones: e.target.value }))}
            rows={2}
            className="rounded-lg border px-3 py-2 bg-white dark:bg-zinc-700 border-zinc-300 dark:border-zinc-600"
          />
        </label>
        <div className="sm:col-span-2 flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-emerald-600 text-white px-5 py-2 font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? "Guardando…" : editId ? "Actualizar" : "Guardar"}
          </button>
          {editId && (
            <button
              type="button"
              className="rounded-lg border border-zinc-300 dark:border-zinc-600 px-5 py-2"
              onClick={() => {
                setEditId(null);
                setForm(empty);
              }}
            >
              Cancelar edición
            </button>
          )}
        </div>
      </form>
      </CollapsibleSection>
    </div>
  );
}

function CobrosTab(props: {
  authHeader: HeadersInit;
  cobros: Record<string, unknown>[];
  facturas: Record<string, unknown>[];
  onRefresh: () => Promise<void>;
  qh: () => string;
  entityId: AccountingEntityId;
  entityQs: () => string;
}) {
  const { authHeader, cobros, facturas, onRefresh, qh, entityId, entityQs } = props;

  const facturaLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of facturas) {
      const id = String(f.id ?? "");
      if (!id) continue;
      const tipo = String(f.tipoComprobante ?? "B");
      const pv = String(f.puntoVenta ?? "").replace(/\D/g, "").padStart(5, "0");
      const nro = String(f.numero ?? "").replace(/\D/g, "").padStart(8, "0");
      map.set(id, `${tipo} ${pv}-${nro}`);
    }
    return map;
  }, [facturas]);

  type F = {
    fecha: string;
    importe: string;
    concepto: string;
    medio: string;
    facturaId: string;
    observaciones: string;
  };
  const [form, setForm] = useState<F>({
    fecha: new Date().toISOString().slice(0, 10),
    importe: "",
    concepto: "",
    medio: "transferencia",
    facturaId: "",
    observaciones: "",
  });
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const importe = Number(String(form.importe).replace(",", "."));
    if (!Number.isFinite(importe) || importe < 0) return;
    setSaving(true);
    try {
      const body = {
        entity: entityId,
        fecha: form.fecha,
        importe,
        concepto: form.concepto.trim(),
        medio: form.medio || undefined,
        facturaId: form.facturaId.trim() || undefined,
        observaciones: form.observaciones.trim() || undefined,
      };
      const url = editId
        ? `/api/accounting/cobros/${editId}?${entityQs()}`
        : "/api/accounting/cobros";
      const res = await fetch(url, {
        method: editId ? "PATCH" : "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        alert("Error guardando cobro");
        return;
      }
      setEditId(null);
      setForm({
        fecha: new Date().toISOString().slice(0, 10),
        importe: "",
        concepto: "",
        medio: "transferencia",
        facturaId: "",
        observaciones: "",
      });
      await onRefresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <TabPageIntro
        title="Cobros"
        description="Entradas de dinero del mes. Al cobrar por Mercado Pago y facturar, el ingreso aparece acá automáticamente vinculado a la factura. También podés importar desde la pestaña Importar o registrar manualmente."
      />
      <div className="rounded-xl bg-white dark:bg-zinc-800 border overflow-hidden shadow-sm">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b bg-zinc-50 dark:bg-zinc-900/60">
              <th className="text-left py-3 px-3">Fecha</th>
              <th className="text-left py-3 px-3">Concepto</th>
              <th className="text-left py-3 px-3">Factura</th>
              <th className="text-right py-3 px-3">Importe</th>
              <th className="text-left py-3 px-3"></th>
            </tr>
          </thead>
          <tbody>
            {cobros.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <EmptyListHint message="No hay cobros en este mes. Los cobros MP facturados se registran solos; también podés importar desde Importar o cargar uno manual." />
                </td>
              </tr>
            ) : (
              cobros.map((row) => {
                const cid = String(row.id ?? "");
                const facturaId = String(row.facturaId ?? "");
                const facturaLabel = facturaId ? facturaLabelById.get(facturaId) : undefined;
                return (
                  <tr key={cid} className="border-b border-zinc-100 dark:border-zinc-700/50">
                    <td className="py-2 px-3 font-mono">{fechaFieldToUi(String(row.fecha ?? ""))}</td>
                    <td className="py-2 px-3">
                      {String(row.concepto ?? "")}
                      {row.mercadopagoPaymentId ? (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-sky-600 dark:text-sky-400">
                          MP #{String(row.mercadopagoPaymentId)}
                        </span>
                      ) : null}
                      {row.bankReference ? (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
                          Banco
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 px-3 text-xs">
                      {facturaLabel ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 px-2 py-0.5 font-medium">
                          {facturaLabel}
                        </span>
                      ) : facturaId ? (
                        <span className="text-zinc-500">ID {facturaId.slice(0, 8)}…</span>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right">{money(Number(row.importe) || 0)}</td>
                    <td className="py-2 px-3 space-x-2">
                      <button
                        type="button"
                        className="text-emerald-600 hover:underline"
                        onClick={() => {
                          setEditId(cid);
                          setForm({
                            fecha: fechaFieldToUi(String(row.fecha ?? "")),
                            importe: String(row.importe ?? ""),
                            concepto: String(row.concepto ?? ""),
                            medio: String(row.medio ?? "transferencia"),
                            facturaId: String(row.facturaId ?? ""),
                            observaciones: String(row.observaciones ?? ""),
                          });
                        }}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="text-red-600 hover:underline"
                        onClick={async () => {
                          if (!confirm("¿Eliminar?")) return;
                          await fetch(`/api/accounting/cobros/${cid}?${entityQs()}`, {
                            method: "DELETE",
                            headers: authHeader,
                          });
                          await onRefresh();
                        }}
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        <p className="text-xs text-zinc-500 p-4">Filtrado: {qh()}</p>
      </div>
      <CollapsibleSection
        title={editId ? "Editar cobro" : "Registrar cobro manual"}
        subtitle="Alta o edición de un ingreso puntual"
        defaultOpen={Boolean(editId)}
        badge={editId ? "editando" : undefined}
      >
      <form className="grid sm:grid-cols-2 gap-4 pt-4" onSubmit={submit}>
        <label className="flex flex-col gap-1 text-sm">
          Fecha
          <input
            type="date"
            required
            value={form.fecha}
            onChange={(e) => setForm((s) => ({ ...s, fecha: e.target.value }))}
            className="rounded-lg border px-3 py-2 bg-white dark:bg-zinc-700 border-zinc-300 dark:border-zinc-600"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Importe
          <input
            required
            value={form.importe}
            onChange={(e) => setForm((s) => ({ ...s, importe: e.target.value }))}
            className="rounded-lg border px-3 py-2 bg-white dark:bg-zinc-700 border-zinc-300 dark:border-zinc-600"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          Concepto
          <input
            required
            value={form.concepto}
            onChange={(e) => setForm((s) => ({ ...s, concepto: e.target.value }))}
            className="rounded-lg border px-3 py-2 bg-white dark:bg-zinc-700 border-zinc-300 dark:border-zinc-600"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Medio
          <select
            value={form.medio}
            onChange={(e) => setForm((s) => ({ ...s, medio: e.target.value }))}
            className="rounded-lg border px-3 py-2 bg-white dark:bg-zinc-700 border-zinc-300 dark:border-zinc-600"
          >
            <option value="transferencia">Transferencia</option>
            <option value="efectivo">Efectivo</option>
            <option value="cheque">Cheque</option>
            <option value="tarjeta">Tarjeta</option>
            <option value="otro">Otro</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Id factura (opcional en Firestore)
          <input
            value={form.facturaId}
            onChange={(e) => setForm((s) => ({ ...s, facturaId: e.target.value }))}
            placeholder="id documento Firebase"
            className="rounded-lg border px-3 py-2 bg-white dark:bg-zinc-700 border-zinc-300 dark:border-zinc-600 font-mono text-xs"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          Observaciones
          <textarea
            rows={2}
            value={form.observaciones}
            onChange={(e) => setForm((s) => ({ ...s, observaciones: e.target.value }))}
            className="rounded-lg border px-3 py-2 bg-white dark:bg-zinc-700 border-zinc-300 dark:border-zinc-600"
          />
        </label>
        <div className="sm:col-span-2 flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-emerald-600 text-white px-5 py-2 font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? "Guardando…" : editId ? "Actualizar" : "Guardar"}
          </button>
          {editId && (
            <button type="button" className="border rounded-lg px-5 py-2" onClick={() => setEditId(null)}>
              Cancelar
            </button>
          )}
        </div>
      </form>
      </CollapsibleSection>
    </div>
  );
}

function PagosTab(props: {
  authHeader: HeadersInit;
  pagos: Record<string, unknown>[];
  onRefresh: () => Promise<void>;
  qh: () => string;
  entityId: AccountingEntityId;
  entityQs: () => string;
  companyLabel: string;
  companyCuit: string;
}) {
  const { authHeader, pagos, onRefresh, qh, entityId, entityQs, companyLabel, companyCuit } = props;

  const [form, setForm] = useState<PagoFormState>(emptyPagoForm);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [receiverCuitDetected, setReceiverCuitDetected] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const resetForm = () => {
    setEditId(null);
    setReceiverCuitDetected(null);
    setForm(emptyPagoForm());
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { ...buildPagoSubmitBody(form), entity: entityId };
      const url = editId
        ? `/api/accounting/pagos/${editId}?${entityQs()}`
        : "/api/accounting/pagos";
      const res = await fetch(url, {
        method: editId ? "PATCH" : "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const err = await res.json().catch(() => ({}));
      if (!res.ok) {
        const details = err?.details?.fieldErrors;
        const msg =
          typeof err?.error === "string"
            ? err.error
            : details
              ? Object.values(details).flat().join("; ")
              : "Error guardando pago";
        alert(msg);
        return;
      }
      resetForm();
      setFormOpen(false);
      await onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const handlePagoExtracted = (extracted: Record<string, unknown>, receiverCuit?: string | null) => {
    setForm(pagoFormFromExtract(extracted));
    setReceiverCuitDetected(receiverCuit ?? null);
    setEditId(null);
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="space-y-6">
      <TabPageIntro
        title="Gastos"
        description="Gastos del mes. Preferí importarlos desde Mis Comprobantes Recibidos (Cargar datos). Acá podés completar PDF o alta manual. Factura A con IVA entra al Libro IVA."
      />
      <CollapsibleSection title="PDF + IA (factura de gasto)" subtitle="Extrae datos fiscales — revisión manual" defaultOpen={false}>
        <div className="pt-4">
          <AccountingPdfAiCard
            authHeader={authHeader}
            mode="pago"
            onDone={onRefresh}
            onPagoExtracted={handlePagoExtracted}
            entityId={entityId}
            entityQs={entityQs}
          />
        </div>
      </CollapsibleSection>
      <CollapsibleSection
        title={editId ? "Editar gasto" : "Registrar gasto"}
        subtitle="Datos fiscales, IVA y contabilidad"
        defaultOpen={formOpen || Boolean(editId)}
        badge={editId ? "editando" : undefined}
      >
        <PagoForm
          form={form}
          setForm={setForm}
          editId={editId}
          saving={saving}
          onSubmit={submit}
          onCancel={() => {
            resetForm();
            setFormOpen(false);
          }}
          receiverCuitDetected={receiverCuitDetected}
          companyLabel={companyLabel}
          companyCuit={companyCuit}
        />
      </CollapsibleSection>

      <div className="rounded-xl bg-white dark:bg-zinc-800 border overflow-hidden shadow-sm">
        <table className="w-full text-sm min-w-[820px]">
          <thead>
            <tr className="border-b bg-zinc-50 dark:bg-zinc-900/60">
              <th className="text-left py-3 px-3">Fecha pago</th>
              <th className="text-left py-3 px-3">Proveedor</th>
              <th className="text-left py-3 px-3">Concepto</th>
              <th className="text-left py-3 px-3">Comprobante</th>
              <th className="text-center py-3 px-3">IVA</th>
              <th className="text-right py-3 px-3">Importe</th>
              <th className="text-left py-3 px-3"></th>
            </tr>
          </thead>
          <tbody>
            {pagos.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <EmptyListHint message="No hay gastos en este mes. Cargá con PDF + IA o alta manual." />
                </td>
              </tr>
            ) : (
              pagos.map((row) => {
                const pid = String(row.id ?? "");
                const invoiceLabel =
                  row.invoiceType === "factura_a"
                    ? "FA"
                    : row.invoiceType === "factura_b"
                      ? "FB"
                      : row.invoiceType
                        ? String(row.invoiceType).slice(0, 6)
                        : "—";
                return (
                  <tr key={pid} className="border-b border-zinc-100 dark:border-zinc-700/50">
                    <td className="py-2 px-3 font-mono text-xs">
                      {fechaFieldToUi(String(row.paymentDate ?? row.fecha ?? ""))}
                    </td>
                    <td className="py-2 px-3 max-w-[140px] truncate" title={String(row.supplierName ?? row.proveedor ?? "")}>
                      {String(row.supplierName ?? row.proveedor ?? "—")}
                    </td>
                    <td className="py-2 px-3">
                      {String(row.concepto ?? "")}
                      {row.bankReference ? (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
                          Banco
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 px-3 font-mono text-xs">
                      {row.posNumber || row.invoiceNumber
                        ? `${String(row.posNumber ?? "")}-${String(row.invoiceNumber ?? "")}`
                        : invoiceLabel}
                    </td>
                    <td className="py-2 px-3 text-center">
                      {row.isVatComputable === true ? (
                        <span className="text-[10px] uppercase font-medium text-emerald-600 dark:text-emerald-400">
                          CF
                        </span>
                      ) : (
                        <span className="text-[10px] text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right">{money(Number(row.totalAmount ?? row.importe) || 0)}</td>
                    <td className="py-2 px-3 space-x-2">
                      <button
                        type="button"
                        className="text-emerald-600 hover:underline"
                        onClick={() => {
                          setEditId(pid);
                          setForm(pagoFormFromRecord(row));
                          setReceiverCuitDetected(null);
                          setFormOpen(true);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="text-red-600 hover:underline"
                        onClick={async () => {
                          if (!confirm("¿Eliminar?")) return;
                          await fetch(`/api/accounting/pagos/${pid}?${entityQs()}`, {
                            method: "DELETE",
                            headers: authHeader,
                          });
                          await onRefresh();
                        }}
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        <p className="text-xs text-zinc-500 p-4">Filtrado: {qh()}</p>
      </div>
    </div>
  );
}
