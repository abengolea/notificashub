"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { armarBorradorJsonAfip } from "@/lib/billing/afip-draft";

const IVA_OPTIONS = [
  { v: "responsable_inscripto", label: "IVA Responsable Inscripto" },
  { v: "monotributo", label: "Monotributo" },
  { v: "exento", label: "Exento" },
  { v: "consumidor_final", label: "Consumidor final" },
  { v: "no_categorizado", label: "No categorizado / otro" },
] as const;

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

type BillingClientRow = {
  id: string;
  active: boolean;
  razonSocial: string;
  cuit: string;
  ivaCondicion: string;
  domicilio: string;
  emailFacturacion: string;
  mensualidadUsd: number;
  condicionVenta: string;
  tipoComprobanteDefault: string;
  descripcionServicio: string;
};

type SubTab = "clientes" | "facturacion";

function lastDayOfMonthIso(year: number, month1to12: number): string {
  const d = new Date(Date.UTC(year, month1to12, 0));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function money(n: number): string {
  return n.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
  });
}

function nowPeriod() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export function FacturacionPanel({ authHeader }: { authHeader: HeadersInit }) {
  const [subTab, setSubTab] = useState<SubTab>("clientes");

  const { year: yNow, month: mNow } = nowPeriod();
  const [refYear, setRefYear] = useState(yNow.toString());
  const [refMonth, setRefMonth] = useState(mNow.toString());

  const yNum = parseInt(refYear, 10);
  const mNum = parseInt(refMonth, 10);
  const defaultFechaMes = useMemo(() => {
    if (!Number.isFinite(yNum) || !Number.isFinite(mNum) || mNum < 1 || mNum > 12) {
      return new Date().toISOString().slice(0, 10);
    }
    return lastDayOfMonthIso(yNum, mNum);
  }, [yNum, mNum]);

  const [clients, setClients] = useState<BillingClientRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const emptyForm = useMemo(
    () => ({
      editingId: "" as string,
      razonSocial: "",
      cuit: "",
      ivaCondicion: "responsable_inscripto",
      domicilio: "",
      emailFacturacion: "",
      mensualidadUsd: 150,
      condicionVenta: "Transferencia bancaria",
      tipoComprobanteDefault: "A",
      descripcionServicio:
        "Servicio mensual de licencia y soporte de la plataforma Notificas Hub, conforme contrato entre las partes.",
      active: true,
    }),
    [],
  );

  const [form, setForm] = useState(emptyForm);
  /** Mostrar formulario solo al dar de alta o editar (listado simple arriba). */
  const [clientFormOpen, setClientFormOpen] = useState(false);

  const [selectedClientId, setSelectedClientId] = useState("");
  const pendingScrollFacturacion = useRef(false);
  const [fechaEmision, setFechaEmision] = useState(defaultFechaMes);
  const [arsManual, setArsManual] = useState("");
  const [cotizacionInfo, setCotizacionInfo] = useState<string>("");
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [numero, setNumero] = useState("");
  const [puntoVenta, setPuntoVenta] = useState("");
  const [enviarEmail, setEnviarEmail] = useState(true);
  const [iaTexto, setIaTexto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (subTab !== "facturacion" || !pendingScrollFacturacion.current) return;
    pendingScrollFacturacion.current = false;
    const t = window.setTimeout(() => {
      document.getElementById("facturacion-emitir")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
    return () => window.clearTimeout(t);
  }, [subTab]);

  useEffect(() => {
    setFechaEmision(defaultFechaMes);
  }, [defaultFechaMes]);

  const loadClients = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/billing/clients", { headers: authHeader });
      if (!res.ok) {
        setErr(`No se pudieron cargar clientes (${res.status})`);
        return;
      }
      const j = (await res.json()) as { clients?: BillingClientRow[] };
      setClients(j.clients ?? []);
    } catch {
      setErr("Error de red al cargar clientes.");
    } finally {
      setLoading(false);
    }
  }, [authHeader]);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  const fillSemEjemplo = () => {
    setForm({
      editingId: "",
      razonSocial: "SEAM SERVICIOS ELECTRICOS SRL",
      cuit: "30667119517",
      ivaCondicion: "responsable_inscripto",
      domicilio: "Av. Savio 862 — San Nicolás, Buenos Aires",
      emailFacturacion: "",
      mensualidadUsd: 150,
      condicionVenta: "Transferencia bancaria",
      tipoComprobanteDefault: "A",
      descripcionServicio:
        "Servicio mensual de licencia y soporte de la plataforma Notificas Hub, conforme contrato entre las partes.",
      active: true,
    });
    setMsg("Datos SEM cargados en el formulario. Completá el email de facturación y guardá.");
    setClientFormOpen(true);
  };

  const guardarCliente = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      if (!form.emailFacturacion.trim()) {
        setErr("El email de facturación es obligatorio para guardar y para el envío automático.");
        setBusy(false);
        return;
      }
      const body = {
        razonSocial: form.razonSocial,
        cuit: form.cuit,
        ivaCondicion: form.ivaCondicion,
        domicilio: form.domicilio,
        emailFacturacion: form.emailFacturacion,
        mensualidadUsd: form.mensualidadUsd,
        condicionVenta: form.condicionVenta,
        tipoComprobanteDefault: form.tipoComprobanteDefault,
        descripcionServicio: form.descripcionServicio,
        active: form.active,
      };
      if (form.editingId) {
        const res = await fetch(`/api/billing/clients/${form.editingId}`, {
          method: "PATCH",
          headers: { ...authHeader, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          setErr(typeof j?.error === "string" ? j.error : `HTTP ${res.status}`);
          return;
        }
        setMsg("Cliente actualizado.");
      } else {
        const res = await fetch("/api/billing/clients", {
          method: "POST",
          headers: { ...authHeader, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          setErr(typeof j?.error === "string" ? j.error : `HTTP ${res.status}`);
          return;
        }
        setMsg("Cliente creado.");
      }
      setForm(emptyForm);
      setClientFormOpen(false);
      await loadClients();
    } finally {
      setBusy(false);
    }
  };

  const editar = (c: BillingClientRow) => {
    setSubTab("clientes");
    setClientFormOpen(true);
    setForm({
      editingId: c.id,
      razonSocial: c.razonSocial,
      cuit: c.cuit,
      ivaCondicion: c.ivaCondicion,
      domicilio: c.domicilio,
      emailFacturacion: c.emailFacturacion,
      mensualidadUsd: c.mensualidadUsd,
      condicionVenta: c.condicionVenta,
      tipoComprobanteDefault: c.tipoComprobanteDefault,
      descripcionServicio: c.descripcionServicio,
      active: c.active,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const irAFacturarMes = (clientId: string) => {
    const c = clients.find((x) => x.id === clientId);
    if (!c) return;
    if (!c.active) {
      setErr("Este cliente está inactivo. Activarlo antes de facturar.");
      return;
    }
    setErr(null);
    setMsg(null);
    setPreview(null);
    setIaTexto(null);
    setSelectedClientId(clientId);
    pendingScrollFacturacion.current = true;
    setSubTab("facturacion");
  };

  const eliminar = async (id: string) => {
    if (!confirm("¿Eliminar este cliente del listado recurrente?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/billing/clients/${id}`, { method: "DELETE", headers: authHeader });
      if (!res.ok) {
        setErr("No se pudo eliminar");
        return;
      }
      await loadClients();
      if (selectedClientId === id) setSelectedClientId("");
    } finally {
      setBusy(false);
    }
  };

  const traerCotizacion = async () => {
    setBusy(true);
    setErr(null);
    setCotizacionInfo("");
    try {
      const res = await fetch("/api/billing/exchange-rate", { headers: authHeader });
      const j = await res.json();
      if (!res.ok) {
        setErr(typeof j?.error === "string" ? j.error : "Cotización no disponible");
        return;
      }
      const venta = Number(j.venta);
      if (Number.isFinite(venta)) setArsManual(String(venta));
      setCotizacionInfo(
        typeof j.fuente === "string"
          ? `${j.fuente}${j.fechaActualizacionISO ? ` · actualizado ${j.fechaActualizacionISO}` : ""}`
          : "",
      );
    } finally {
      setBusy(false);
    }
  };

  const previsualizar = async () => {
    if (!selectedClientId) {
      setErr("Elegí un cliente");
      return;
    }
    setBusy(true);
    setErr(null);
    setPreview(null);
    setIaTexto(null);
    try {
      const manual = arsManual.trim() ? parseFloat(arsManual.replace(",", ".")) : undefined;
      const res = await fetch("/api/billing/preview", {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: selectedClientId,
          fecha: fechaEmision,
          ...(manual != null && Number.isFinite(manual) && manual > 0 ? { arsPorUsdManual: manual } : {}),
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(typeof j?.error === "string" ? j.error : `HTTP ${res.status}`);
        return;
      }
      setPreview(j);
      if (!arsManual.trim() && typeof j.fuenteTipoCambio === "string") {
        setCotizacionInfo(String(j.fuenteTipoCambio));
      }
    } finally {
      setBusy(false);
    }
  };

  const revisarIa = async () => {
    if (!preview || !preview.cliente) {
      setErr("Primero generá la previsualización");
      return;
    }
    const cli = preview.cliente as Record<string, unknown>;
    setBusy(true);
    setErr(null);
    setIaTexto(null);
    try {
      const res = await fetch("/api/billing/verify-ai", {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          clientRazonSocial: String(cli.razonSocial ?? ""),
          cuit: String(cli.cuit ?? ""),
          fecha: fechaEmision,
          usd: Number(cli.mensualidadUsd ?? 0),
          arsPorUsd: Number(preview.arsPorUsdUsado ?? 0),
          netoGravado: Number(preview.netoGravado ?? 0),
          iva: Number(preview.iva ?? 0),
          total: Number(preview.total ?? 0),
          fuenteTipoCambio: String(preview.fuenteTipoCambio ?? cotizacionInfo ?? ""),
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(typeof j?.error === "string" ? j.error : "IA no disponible");
        return;
      }
      setIaTexto(typeof j.texto === "string" ? j.texto : null);
    } finally {
      setBusy(false);
    }
  };

  const emitir = async () => {
    if (!selectedClientId || !numero.trim()) {
      setErr("Cliente y número de comprobante son obligatorios");
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const manual = arsManual.trim() ? parseFloat(arsManual.replace(",", ".")) : undefined;
      const res = await fetch("/api/billing/issue", {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: selectedClientId,
          fecha: fechaEmision,
          numero: numero.trim(),
          puntoVenta: puntoVenta.trim() || undefined,
          enviarEmail,
          ...(manual != null && Number.isFinite(manual) && manual > 0 ? { arsPorUsdManual: manual } : {}),
        }),
      });
      const j = await res.json();
      if (res.status === 409) {
        setErr(
          typeof j?.error === "string"
            ? `${j.error}${j.facturaId ? ` (id: ${j.facturaId})` : ""}`
            : "Duplicado para el período",
        );
        return;
      }
      if (!res.ok) {
        setErr(typeof j?.error === "string" ? j.error : `HTTP ${res.status}`);
        return;
      }
      let m = `Factura registrada (id ${j.facturaId}).`;
      const em = j.email as { ok?: boolean; error?: string } | null | undefined;
      if (em?.ok === false && em.error) m += ` Mail: ${em.error}`;
      if (em?.ok === true) m += " Mail enviado.";
      setMsg(m);
      setPreview(null);
      setIaTexto(null);
    } finally {
      setBusy(false);
    }
  };

  const descargarBorradorAfip = () => {
    if (!preview || !selectedClientId) {
      setErr("Primero previsualizá los importes.");
      return;
    }
    const cli = preview.cliente as Record<string, unknown> | undefined;
    if (!cli) {
      setErr("No hay datos de cliente en la previsualización.");
      return;
    }
    setErr(null);
    const pv = (puntoVenta.trim() || "00002").padStart(5, "0");
    const draft = armarBorradorJsonAfip({
      fechaIsoYMD: fechaEmision,
      puntoVentaPadded: pv,
      numeroComprobante: numero.trim() || undefined,
      cliente: {
        razonSocial: String(cli.razonSocial ?? ""),
        cuit: String(cli.cuit ?? ""),
        tipoComprobanteDefault: String(cli.tipoComprobanteDefault ?? "A"),
      },
      netoGravado: Number(preview.netoGravado ?? 0),
      iva: Number(preview.iva ?? 0),
      total: Number(preview.total ?? 0),
      tipoCambioUsdReferencia: Number.isFinite(Number(preview.arsPorUsdUsado))
        ? Number(preview.arsPorUsdUsado)
        : undefined,
    });
    const json = JSON.stringify(draft, null, 2);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName = `borrador_afip_${fechaEmision}_${selectedClientId.slice(0, 8)}.json`;
    a.href = url;
    a.download = safeName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const solicitarCaeAfip = async () => {
    if (!preview || !selectedClientId) {
      setErr("Primero previsualizá los importes.");
      return;
    }
    const rawPv = puntoVenta.trim().replace(/\D/g, "").replace(/^0+/, "") || "";
    const pvNum = rawPv ? parseInt(rawPv, 10) : 0;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const manual = arsManual.trim() ? parseFloat(arsManual.replace(",", ".")) : undefined;
      const res = await fetch("/api/billing/afip/cae", {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: selectedClientId,
          fecha: fechaEmision,
          ...(pvNum > 0 ? { ptoVta: pvNum } : {}),
          ...(manual != null && Number.isFinite(manual) && manual > 0 ? { arsPorUsdManual: manual } : {}),
        }),
      });
      const j = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setErr(typeof j.error === "string" ? j.error : `HTTP ${res.status}`);
        return;
      }
      const cae = String(j.CAE ?? "");
      const vto = String(j.CAEFchVto ?? "");
      const nro = j.voucherNumber;
      setMsg(
        `CAE: ${cae} — vto. ${vto}${typeof nro === "number" ? ` — N.º comprobante AFIP: ${nro}` : ""}. Podés registrar en contabilidad con ese número y el mail al cliente.`,
      );
      if (typeof nro === "number") setNumero(String(nro));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <nav className="flex flex-wrap gap-2">
        {(
          [
            ["clientes", "Clientes"],
            ["facturacion", "Facturación mensual"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setErr(null);
              setSubTab(id);
            }}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              subTab === id
                ? "bg-emerald-600 text-white"
                : "bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 hover:border-emerald-500/50"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {subTab === "facturacion" && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Facturación en pesos a partir de USD mensuales y tipo de cambio venta (referencia API &quot;oficial&quot;;
          contrastá con el <strong>dólar vendedor Banco Nación</strong> y ajustá el valor manual si hace falta). El importe
          lo calcula el servidor; la revisión con IA es opcional.
          <span className="block mt-2 text-amber-800 dark:text-amber-200/90 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2">
            <strong>AFIP (Notificas SRL):</strong> el <strong>emisor</strong> del comprobante electrónico es siempre{" "}
            <strong>Notificas SRL</strong> (mismo CUIT que el certificado en <code className="text-xs">AFIP_CUIT</code>).
            Los clientes del listado son solo <strong>receptores</strong>. Después de previsualizar podés pedir{" "}
            <strong>CAE</strong> (cert + clave en el servidor; opcional <code className="text-xs">AFIP_ACCESS_TOKEN</code>).
            También podés usar el <strong>borrador JSON</strong> para revisión o integraciones externas.
          </span>
        </p>
      )}

      {err && (
        <p className="text-sm text-red-600 dark:text-red-400 rounded-lg border border-red-300 dark:border-red-700 p-3">
          {err}
        </p>
      )}
      {msg && (
        <p className="text-sm text-emerald-700 dark:text-emerald-300 rounded-lg border border-emerald-300 dark:border-emerald-800 p-3">
          {msg}
        </p>
      )}

      {subTab === "clientes" && (
        <div className="space-y-6">
          <div className="rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-6 shadow-sm">
            <div className="flex flex-wrap gap-3 items-center justify-between mb-2">
              <div>
                <h2 className="text-lg font-semibold">Tus clientes</h2>
                <p className="text-sm text-zinc-500 mt-1">Listado breve. Facturación del mes abre la otra pestaña con el cliente elegido.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={fillSemEjemplo}
                  className="text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-700/60"
                >
                  Cargar ejemplo SEM
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setForm(emptyForm);
                    setClientFormOpen(true);
                    setErr(null);
                  }}
                  className="text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-700/60"
                >
                  Nuevo cliente
                </button>
              </div>
            </div>

            {loading ? (
              <p className="text-sm text-zinc-500 py-6">Cargando…</p>
            ) : clients.length === 0 ? (
              <p className="text-sm text-zinc-500 py-8 text-center rounded-lg border border-dashed border-zinc-300 dark:border-zinc-600">
                Todavía no hay clientes. Usá &quot;Nuevo cliente&quot; o &quot;Cargar ejemplo SEM&quot;.
              </p>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-700 rounded-xl border border-zinc-200 dark:border-zinc-600 overflow-hidden mt-4">
                {clients.map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-4 py-4 bg-white dark:bg-zinc-800/80"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                        {c.razonSocial}
                        {!c.active && (
                          <span className="ml-2 text-xs font-normal text-amber-600 dark:text-amber-400">(inactivo)</span>
                        )}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 font-mono truncate">
                        {c.cuit} · {c.emailFacturacion || "sin email"}
                      </p>
                      <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-1">
                        USD {c.mensualidadUsd}/mes · Comprobante {c.tipoComprobanteDefault}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={!c.active}
                        title={!c.active ? "Activá el cliente para facturar" : undefined}
                        onClick={() => irAFacturarMes(c.id)}
                        className="rounded-lg bg-emerald-600 text-white px-3 py-2 text-sm font-medium hover:bg-emerald-700 disabled:opacity-45 disabled:cursor-not-allowed"
                      >
                        Facturación del mes
                      </button>
                      <button
                        type="button"
                        onClick={() => editar(c)}
                        className="rounded-lg border border-zinc-300 dark:border-zinc-600 px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-700/60"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => eliminar(c.id)}
                        className="rounded-lg px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                      >
                        Borrar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {(clientFormOpen || form.editingId) && (
            <div className="rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h3 className="font-semibold">{form.editingId ? "Editar cliente" : "Nuevo cliente"}</h3>
                <button
                  type="button"
                  onClick={() => {
                    setClientFormOpen(false);
                    setForm(emptyForm);
                    setErr(null);
                  }}
                  className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                >
                  Cerrar formulario
                </button>
              </div>
              <div className="grid md:grid-cols-2 gap-4 text-sm">
                <label className="flex flex-col gap-1">
                  Razón social
                  <input
                    value={form.razonSocial}
                    onChange={(e) => setForm((f) => ({ ...f, razonSocial: e.target.value }))}
                    className="rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 px-3 py-2"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  CUIT
                  <input
                    value={form.cuit}
                    onChange={(e) => setForm((f) => ({ ...f, cuit: e.target.value }))}
                    className="rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 px-3 py-2 font-mono"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  Condición IVA (referencia cliente)
                  <select
                    value={form.ivaCondicion}
                    onChange={(e) => setForm((f) => ({ ...f, ivaCondicion: e.target.value }))}
                    className="rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 px-3 py-2"
                  >
                    {IVA_OPTIONS.map((o) => (
                      <option key={o.v} value={o.v}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  Mensualidad (USD)
                  <input
                    type="number"
                    min={0.01}
                    step={0.01}
                    value={form.mensualidadUsd}
                    onChange={(e) => setForm((f) => ({ ...f, mensualidadUsd: parseFloat(e.target.value) || 0 }))}
                    className="rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 px-3 py-2"
                  />
                </label>
                <label className="flex flex-col gap-1 md:col-span-2">
                  Domicilio comercial
                  <input
                    value={form.domicilio}
                    onChange={(e) => setForm((f) => ({ ...f, domicilio: e.target.value }))}
                    className="rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 px-3 py-2"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  Email facturación / avisos
                  <input
                    type="email"
                    value={form.emailFacturacion}
                    onChange={(e) => setForm((f) => ({ ...f, emailFacturacion: e.target.value }))}
                    className="rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 px-3 py-2"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  Condición de venta
                  <input
                    value={form.condicionVenta}
                    onChange={(e) => setForm((f) => ({ ...f, condicionVenta: e.target.value }))}
                    className="rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 px-3 py-2"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  Comprobante por defecto
                  <select
                    value={form.tipoComprobanteDefault}
                    onChange={(e) => setForm((f) => ({ ...f, tipoComprobanteDefault: e.target.value }))}
                    className="rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 px-3 py-2"
                  >
                    <option value="A">Factura A (precio + IVA aparte)</option>
                    <option value="B">Factura B (precio final con IVA incluido)</option>
                    <option value="C">Factura C (sin IVA)</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 justify-center">
                  <span className="inline-flex items-center gap-2 mt-6">
                    <input
                      type="checkbox"
                      checked={form.active}
                      onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                    />
                    Activo
                  </span>
                </label>
                <label className="flex flex-col gap-1 md:col-span-2">
                  Descripción del servicio (observaciones / ítem)
                  <textarea
                    rows={3}
                    value={form.descripcionServicio}
                    onChange={(e) => setForm((f) => ({ ...f, descripcionServicio: e.target.value }))}
                    className="rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 px-3 py-2"
                  />
                </label>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={guardarCliente}
                className="mt-4 rounded-lg bg-emerald-600 text-white px-5 py-2.5 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
              >
                {form.editingId ? "Guardar cambios" : "Guardar cliente"}
              </button>
            </div>
          )}
        </div>
      )}

      {subTab === "facturacion" && (
        <div id="facturacion-emitir" className="rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-6 shadow-sm scroll-mt-6">
          <h2 className="text-lg font-semibold mb-4">Emitir factura del período</h2>
          {selectedClientId && (
            <p className="text-sm text-emerald-800 dark:text-emerald-200/90 mb-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-3 py-2">
              Cliente seleccionado:{" "}
              <strong>{clients.find((c) => c.id === selectedClientId)?.razonSocial ?? selectedClientId}</strong>
            </p>
          )}

          <div className="flex flex-wrap gap-4 items-end mb-6 pb-6 border-b border-zinc-200 dark:border-zinc-700">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-zinc-600 dark:text-zinc-400">Mes de referencia (fecha sugerida)</span>
              <select
                value={refMonth}
                onChange={(e) => setRefMonth(e.target.value)}
                className="rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 px-3 py-2 min-w-[10rem]"
              >
                {MONTHS.map((m) => (
                  <option key={m.v} value={m.v}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-zinc-600 dark:text-zinc-400">Año</span>
              <input
                type="number"
                min={2020}
                max={2099}
                value={refYear}
                onChange={(e) => setRefYear(e.target.value)}
                className="rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 px-3 py-2 w-28"
              />
            </label>
            <p className="text-xs text-zinc-500 max-w-md">
              La fecha de emisión por defecto es el último día de este mes; podés cambiarla abajo antes de emitir.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <label className="flex flex-col gap-1">
              Cliente
              <select
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                className="rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 px-3 py-2"
              >
                <option value="">— Elegir —</option>
                {clients.filter((c) => c.active).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.razonSocial} — USD {c.mensualidadUsd}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Fecha de emisión
              <input
                type="date"
                value={fechaEmision}
                onChange={(e) => setFechaEmision(e.target.value)}
                className="rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 md:col-span-2">
              ARS por 1 USD (venta). Dejá vacío para consultar la API automática o pegá el BNA del día.
              <div className="flex flex-wrap gap-2">
                <input
                  value={arsManual}
                  onChange={(e) => setArsManual(e.target.value)}
                  placeholder="Ej. 1415"
                  className="flex-1 min-w-[8rem] rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 px-3 py-2 font-mono"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={traerCotizacion}
                  className="rounded-lg border border-zinc-300 dark:border-zinc-600 px-4 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-700/60 disabled:opacity-50"
                >
                  Traer cotización referencia
                </button>
              </div>
              {cotizacionInfo && <span className="text-xs text-zinc-500">{cotizacionInfo}</span>}
            </label>
            <label className="flex flex-col gap-1">
              Punto de venta (AFIP)
              <input
                value={puntoVenta}
                onChange={(e) => setPuntoVenta(e.target.value)}
                placeholder="Vacío = AFIP_PTO_VTA del servidor"
                className="rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 px-3 py-2 font-mono"
              />
            </label>
            <label className="flex flex-col gap-1">
              Número de comprobante
              <input
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                className="rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 px-3 py-2 font-mono"
              />
            </label>
            <label className="flex flex-col gap-1 md:col-span-2 justify-center">
              <span className="inline-flex items-center gap-2">
                <input type="checkbox" checked={enviarEmail} onChange={(e) => setEnviarEmail(e.target.checked)} />
                Enviar mail al cliente al emitir (Resend)
              </span>
            </label>
          </div>

          <div className="flex flex-wrap gap-3 mt-6">
            <button
              type="button"
              disabled={busy}
              onClick={previsualizar}
              className="rounded-lg bg-slate-800 dark:bg-slate-700 text-white px-4 py-2.5 text-sm font-medium disabled:opacity-50"
            >
              Previsualizar importes
            </button>
            <button
              type="button"
              disabled={!preview || busy}
              onClick={descargarBorradorAfip}
              className="rounded-lg border border-amber-500/80 text-amber-900 dark:text-amber-100 bg-amber-50 dark:bg-amber-950/50 px-4 py-2.5 text-sm font-medium disabled:opacity-45"
              title="Sin CAE: solo archivo orientativo para ARCA / integrador / contador"
            >
              Borrador ante AFIP (JSON)
            </button>
            <button
              type="button"
              disabled={!preview || busy}
              onClick={solicitarCaeAfip}
              className="rounded-lg bg-blue-700 text-white px-4 py-2.5 text-sm font-medium hover:bg-blue-800 disabled:opacity-45"
              title="Requiere AFIP_CUIT, cert y key. PV por defecto: AFIP_PTO_VTA si el campo está vacío"
            >
              Solicitar CAE (AFIP)
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={revisarIa}
              className="rounded-lg border border-violet-400 text-violet-800 dark:text-violet-200 px-4 py-2.5 text-sm font-medium disabled:opacity-50"
            >
              Revisión asistida (IA)
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={emitir}
              className="rounded-lg bg-emerald-600 text-white px-4 py-2.5 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              Registrar en contabilidad + mail
            </button>
          </div>

          {preview && (
            <div className="mt-6 rounded-lg border border-zinc-200 dark:border-zinc-600 p-4 text-sm space-y-2 bg-zinc-50 dark:bg-zinc-900/40">
              <p>
                <strong>Neto:</strong> {money(Number(preview.netoGravado ?? 0))} · <strong>IVA:</strong>{" "}
                {money(Number(preview.iva ?? 0))} · <strong>Total:</strong> {money(Number(preview.total ?? 0))}
              </p>
              <p className="text-zinc-600 dark:text-zinc-400">
                Tipo cambio usado: <strong>{String(preview.arsPorUsdUsado ?? "")}</strong> ARS/USD
              </p>
            </div>
          )}
          {iaTexto && (
            <div className="mt-4 rounded-lg border border-violet-300 dark:border-violet-800 p-4 text-sm bg-violet-50 dark:bg-violet-950/30">
              <p className="font-medium text-violet-900 dark:text-violet-200 mb-1">Revisión IA</p>
              <p className="text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">{iaTexto}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
