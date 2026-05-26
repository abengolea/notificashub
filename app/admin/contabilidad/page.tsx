"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArcaTab, ContabTabBar, TabPageIntro, type TabId } from "./contabilidad-shell";
import { periodLabel as formatPeriodLabel } from "./contabilidad-tabs";
import { DASHBOARD_TOKEN_STORAGE_KEY } from "@/lib/dashboard-session";
import { fechaFieldToUi } from "@/lib/accounting/serialize";

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

  const authHeader = useMemo((): HeadersInit => {
    return token ? ({ Authorization: `Bearer ${token}` } as HeadersInit) : {};
  }, [token]);

  useEffect(() => {
    setToken(sessionStorage.getItem(DASHBOARD_TOKEN_STORAGE_KEY));
  }, []);

  const qh = useCallback(() => `year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}`, [year, month]);

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

  const descargaZipArcaLibro = useCallback(async () => {
    if (!token) return;
    const yNum = parseInt(year, 10);
    const mNum = parseInt(month, 10);
    setExportingZip(true);
    try {
      const res = await fetch(
        `/api/accounting/export-libro-iva?year=${encodeURIComponent(String(yNum))}&month=${encodeURIComponent(String(mNum))}`,
        { headers: authHeader },
      );
      if (res.status === 401) {
        sessionStorage.removeItem(DASHBOARD_TOKEN_STORAGE_KEY);
        setToken(null);
        return;
      }
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const j = (await res.json()) as { detalle?: string; error?: string };
          msg = j.detalle ?? j.error ?? msg;
        } catch {
          //
        }
        alert(msg);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `libroiva_ARCA_${yNum}-${String(mNum).padStart(2, "0")}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert("Error descargando el ZIP ARCA.");
    } finally {
      setExportingZip(false);
    }
  }, [token, year, month, authHeader]);

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
    if (!token) return;
    (async () => {
      setLoading(true);
      await Promise.all([loadResumen(), loadLists()]);
      setLoading(false);
    })();
  }, [token, year, month, loadResumen, loadLists]);

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
            <p className="text-sm text-zinc-500 mt-1">Notificas SRL · movimientos, facturas e IVA orientativo</p>
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
            <label className="flex flex-col gap-0.5 text-xs">
              <span className="font-medium text-zinc-500 uppercase tracking-wide">Período</span>
              <div className="flex gap-2">
                <select
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm min-w-[9rem]"
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
                  className="rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm w-24"
                />
              </div>
            </label>
            {loading ? (
              <span className="text-xs text-zinc-500 pb-2">Actualizando…</span>
            ) : (
              <span className="text-xs text-zinc-500 pb-2 hidden sm:inline">{periodLabel(month, year)}</span>
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
          />
        </div>

        {tab === "panel" && (
          <div className="space-y-6">
            {resumen ? (
              <ResumenBlock data={resumen} moneyFn={money} periodLabel={periodLabel(month, year)} />
            ) : loading ? (
              <p className="text-sm text-zinc-500">Cargando resumen…</p>
            ) : null}
          </div>
        )}
        {tab === "cobros" && (
          <CobrosTab authHeader={authHeader} cobros={cobros} onRefresh={loadLists} qh={qh} />
        )}
        {tab === "pagos" && <PagosTab authHeader={authHeader} pagos={pagos} onRefresh={loadLists} qh={qh} />}
        {tab === "facturas" && (
          <FacturasTab authHeader={authHeader} facturas={facturas} onRefresh={loadLists} qh={qh} />
        )}
        {tab === "importar" && (
          <ImportarTab authHeader={authHeader} onDone={refreshAll} onGoTab={setTab} />
        )}
        {tab === "arca" && (
          <ArcaTab
            month={month}
            year={year}
            exportingZip={exportingZip}
            descargaZipArcaLibro={descargaZipArcaLibro}
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
      </div>
    </div>
  );
}

function MercadoPagoImportCard(props: {
  authHeader: HeadersInit;
  onDone: () => Promise<void>;
}) {
  const { authHeader, onDone } = props;
  const [mpSyncing, setMpSyncing] = useState(false);
  const [mpRange, setMpRange] = useState({ begin: "", end: "" });

  const syncMercadoPago = async () => {
    setMpSyncing(true);
    try {
      const body =
        mpRange.begin.trim() && mpRange.end.trim()
          ? { begin: mpRange.begin.trim(), end: mpRange.end.trim() }
          : {};
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
      <h3 className="font-semibold text-sky-900 dark:text-sky-100 mb-1">Mercado Pago</h3>
      <p className="text-sm text-sky-800 dark:text-sky-200 mb-4">
        Importa cobros aprobados. Sin duplicar por id de pago.
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
          disabled={mpSyncing || Boolean(mpRange.begin) !== Boolean(mpRange.end)}
          onClick={() => void syncMercadoPago()}
          className="rounded-lg bg-sky-600 text-white px-5 py-2 font-medium hover:bg-sky-700 disabled:opacity-50"
        >
          {mpSyncing ? "Sincronizando…" : "Sincronizar cobros"}
        </button>
      </div>
    </div>
  );
}

function ImportarTab(props: {
  authHeader: HeadersInit;
  onDone: () => Promise<void>;
  onGoTab: (t: TabId) => void;
}) {
  const { authHeader, onDone, onGoTab } = props;
  return (
    <div className="space-y-6">
      <TabPageIntro
        title="Importar movimientos"
        description="Extracto bancario o Mercado Pago. Los PDF de facturas y gastos están en sus pestañas."
      />
      <BankExtractCard authHeader={authHeader} onDone={onDone} />
      <MercadoPagoImportCard authHeader={authHeader} onDone={onDone} />
      <div className="grid sm:grid-cols-2 gap-4">
        <button
          type="button"
          onClick={() => onGoTab("facturas")}
          className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-4 text-left hover:border-violet-500/50"
        >
          <p className="font-medium text-sm">PDF de facturas</p>
          <p className="text-xs text-zinc-500 mt-1">Pestaña Facturas</p>
        </button>
        <button
          type="button"
          onClick={() => onGoTab("pagos")}
          className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-4 text-left hover:border-violet-500/50"
        >
          <p className="font-medium text-sm">PDF de gastos</p>
          <p className="text-xs text-zinc-500 mt-1">Pestaña Pagos</p>
        </button>
      </div>
    </div>
  );
}

function ResumenBlock({
  data,
  moneyFn,
  periodLabel: periodTitle,
}: {
  data: Record<string, unknown>;
  moneyFn: (n: number) => string;
  periodLabel: string;
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
        description="Resumen orientativo del mes: IVA según facturas y caja según cobros/pagos registrados."
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-4 shadow-sm">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">IVA orientativo</p>
          <p className="text-lg font-bold mt-1 text-amber-700 dark:text-amber-400">{moneyFn(diffIva)}</p>
        </div>
        <div className="rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-4 shadow-sm">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Caja (cobros − pagos)</p>
          <p className="text-lg font-bold mt-1">{moneyFn(tesoreria?.resultadoCajaOrientativo ?? 0)}</p>
        </div>
        <div className="rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-4 shadow-sm">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Facturas</p>
          <p className="text-lg font-bold mt-1">{Number(data.libroFacturasCargadas) || 0}</p>
        </div>
        <div className="rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-4 shadow-sm">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Cobros / Pagos</p>
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
};

function BankExtractCard(props: { authHeader: HeadersInit; onDone: () => Promise<void> }) {
  const { authHeader, onDone } = props;
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
    setBusy(true);
    try {
      const res = await fetch("/api/accounting/bank-ingest", {
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
      <h3 className="font-medium text-zinc-800 dark:text-zinc-100 mb-1">
        Extracto bancario (PDF + IA)
      </h3>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
        Subí el PDF de movimientos de la cuenta corriente. La IA detecta cobros y pagos; revisás la
        tabla y confirmás. No duplica movimientos ya importados. Alimenta la caja del resumen junto
        con facturas y Mercado Pago. El Libro IVA sigue saliendo de facturas.
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
                      {row.duplicate ? (
                        <span className="ml-1 text-[10px] text-zinc-500">(ya cargado)</span>
                      ) : null}
                    </td>
                    <td className="py-2 px-2 max-w-[240px] truncate" title={row.concepto}>
                      {row.concepto}
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
}) {
  const { authHeader, mode, onDone } = props;
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
    if (mode === "factura") fd.append("tipoLibro", tipoLibro);

    setBusy(true);
    try {
      const res = await fetch("/api/accounting/pdf-ingest", {
        method: "POST",
        headers: authHeader,
        body: fd,
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        alert(typeof j?.error === "string" ? j.error : `Error HTTP ${res.status}`);
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
        El archivo se sube a Firebase Storage; Google AI (Gemini) lee el PDF y genera el registro en Firestore.
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
}) {
  const { authHeader, facturas, onRefresh, qh } = props;

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
        editId !== null ? `/api/accounting/facturas/${editId}` : "/api/accounting/facturas";
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
    await fetch(`/api/accounting/facturas/${id}`, { method: "DELETE", headers: authHeader });
    await onRefresh();
  };

  return (
    <div className="space-y-6">
      <TabPageIntro
        title="Facturas"
        description="Compras y ventas del mes para el Libro IVA orientativo. Exportá desde la pestaña ARCA / IVA."
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
          <AccountingPdfAiCard authHeader={authHeader} mode="factura" onDone={onRefresh} />
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
  onRefresh: () => Promise<void>;
  qh: () => string;
}) {
  const { authHeader, cobros, onRefresh, qh } = props;

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
        fecha: form.fecha,
        importe,
        concepto: form.concepto.trim(),
        medio: form.medio || undefined,
        facturaId: form.facturaId.trim() || undefined,
        observaciones: form.observaciones.trim() || undefined,
      };
      const url = editId ? `/api/accounting/cobros/${editId}` : "/api/accounting/cobros";
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
        description="Entradas de dinero del mes. Para importar banco o Mercado Pago usá la pestaña Importar."
      />
      <div className="rounded-xl bg-white dark:bg-zinc-800 border overflow-hidden shadow-sm">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="border-b bg-zinc-50 dark:bg-zinc-900/60">
              <th className="text-left py-3 px-3">Fecha</th>
              <th className="text-left py-3 px-3">Concepto</th>
              <th className="text-right py-3 px-3">Importe</th>
              <th className="text-left py-3 px-3"></th>
            </tr>
          </thead>
          <tbody>
            {cobros.length === 0 ? (
              <tr>
                <td colSpan={4}>
                  <EmptyListHint message="No hay cobros en este mes. Importá desde la pestaña Importar o registrá uno manual." />
                </td>
              </tr>
            ) : (
              cobros.map((row) => {
                const cid = String(row.id ?? "");
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
                          await fetch(`/api/accounting/cobros/${cid}`, {
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
}) {
  const { authHeader, pagos, onRefresh, qh } = props;

  type F = {
    fecha: string;
    importe: string;
    concepto: string;
    proveedor: string;
    medio: string;
    facturaId: string;
    observaciones: string;
  };
  const [form, setForm] = useState<F>({
    fecha: new Date().toISOString().slice(0, 10),
    importe: "",
    concepto: "",
    proveedor: "",
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
        fecha: form.fecha,
        importe,
        concepto: form.concepto.trim(),
        proveedor: form.proveedor.trim() || undefined,
        medio: form.medio || undefined,
        facturaId: form.facturaId.trim() || undefined,
        observaciones: form.observaciones.trim() || undefined,
      };
      const url = editId ? `/api/accounting/pagos/${editId}` : "/api/accounting/pagos";
      const res = await fetch(url, {
        method: editId ? "PATCH" : "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        alert("Error guardando pago");
        return;
      }
      setEditId(null);
      setForm({
        fecha: new Date().toISOString().slice(0, 10),
        importe: "",
        concepto: "",
        proveedor: "",
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
        title="Pagos"
        description="Salidas y gastos del mes. Para PDF de comprobantes o extracto bancario, usá Importar."
      />
      <CollapsibleSection title="PDF + IA (un gasto por archivo)" subtitle="Gemini lee el comprobante" defaultOpen={false}>
        <div className="pt-4">
          <AccountingPdfAiCard authHeader={authHeader} mode="pago" onDone={onRefresh} />
        </div>
      </CollapsibleSection>
      <CollapsibleSection
        title={editId ? "Editar pago" : "Registrar pago manual"}
        subtitle="Alta o edición de un egreso"
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
          Proveedor / destinatario
          <input
            value={form.proveedor}
            onChange={(e) => setForm((s) => ({ ...s, proveedor: e.target.value }))}
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
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          Id factura (opcional)
          <input
            value={form.facturaId}
            onChange={(e) => setForm((s) => ({ ...s, facturaId: e.target.value }))}
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

      <div className="rounded-xl bg-white dark:bg-zinc-800 border overflow-hidden shadow-sm">
        <table className="w-full text-sm min-w-[620px]">
          <thead>
            <tr className="border-b bg-zinc-50 dark:bg-zinc-900/60">
              <th className="text-left py-3 px-3">Fecha</th>
              <th className="text-left py-3 px-3">Proveedor</th>
              <th className="text-left py-3 px-3">Concepto</th>
              <th className="text-right py-3 px-3">Importe</th>
              <th className="text-left py-3 px-3"></th>
            </tr>
          </thead>
          <tbody>
            {pagos.map((row) => {
              const pid = String(row.id ?? "");
              return (
                <tr key={pid} className="border-b border-zinc-100 dark:border-zinc-700/50">
                  <td className="py-2 px-3 font-mono">{fechaFieldToUi(String(row.fecha ?? ""))}</td>
                  <td className="py-2 px-3">{String(row.proveedor ?? "—")}</td>
                  <td className="py-2 px-3">
                    {String(row.concepto ?? "")}
                    {row.bankReference ? (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
                        Banco
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 px-3 text-right">{money(Number(row.importe) || 0)}</td>
                  <td className="py-2 px-3 space-x-2">
                    <button
                      type="button"
                      className="text-emerald-600 hover:underline"
                      onClick={() => {
                        setEditId(pid);
                        setForm({
                          fecha: fechaFieldToUi(String(row.fecha ?? "")),
                          importe: String(row.importe ?? ""),
                          concepto: String(row.concepto ?? ""),
                          proveedor: String(row.proveedor ?? ""),
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
                        await fetch(`/api/accounting/pagos/${pid}`, {
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
            })}
          </tbody>
        </table>
        <p className="text-xs text-zinc-500 p-4">Filtrado: {qh()}</p>
      </div>
    </div>
  );
}
