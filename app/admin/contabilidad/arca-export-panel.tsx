"use client";

import { useCallback, useEffect, useState, type Dispatch, SetStateAction } from "react";
import { ARCA_ARCHIVO_IDS, ARCA_FILE_NAMES, ARCA_IMPORT_GUIDE, type ArcaArchivoId } from "@/lib/arca-export/constants";
import { REGIMEN_SIMPLIFICADO_CATEGORIAS } from "@/lib/sifere-cm05/regimen-simplificado";

type VencRow = {
  periodo: { year: number; month: number; key: string };
  todasISO: string;
  grupoCuilISO: string;
  fechaReferenciaOrientativaISO: string;
  diasHastaOrientativo: number | null;
  alertaOrientativa: boolean;
};

type ArcaValidation = {
  ok: boolean;
  periodo: string;
  warnings: string[];
  compras: {
    comprobantes: number;
    alicuotas: number;
    netoGravado: number;
    iva: number;
    comprobantesExcluidos: number;
  };
  ventas: {
    comprobantes: number;
    alicuotas: number;
    netoGravado: number;
    iva: number;
  };
};

function money(n: number): string {
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 });
}

export function ArcaExportPanel(props: {
  month: string;
  year: string;
  entityId: string;
  isIndividual: boolean;
  authHeader: HeadersInit;
  exporting: boolean;
  exportingCm05: boolean;
  onDownloadArchivo: (id: ArcaArchivoId) => void;
  onDownloadTodos: () => void;
  onDownloadCm05: () => void;
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
  const [validation, setValidation] = useState<ArcaValidation | null>(null);
  const [loadingVal, setLoadingVal] = useState(false);

  const loadValidation = useCallback(async () => {
    setLoadingVal(true);
    try {
      const res = await fetch(
        `/api/accounting/arca-export/validate?year=${encodeURIComponent(p.year)}&month=${encodeURIComponent(p.month)}&entity=${encodeURIComponent(p.entityId)}`,
        { headers: p.authHeader }
      );
      if (res.ok) setValidation(await res.json());
    } finally {
      setLoadingVal(false);
    }
  }, [p.authHeader, p.year, p.month, p.entityId]);

  useEffect(() => {
    void loadValidation();
  }, [loadValidation]);

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 p-6 shadow-sm">
        <h2 className="text-lg font-semibold mb-1">Exportar a ARCA</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
          Acá <strong>salís</strong> hacia ARCA (Libro IVA y CM05). Para <strong>traer</strong>{" "}
          comprobantes desde Mis Comprobantes usá la pestaña <strong>Cargar datos</strong>.
        </p>

        {loadingVal ? (
          <p className="text-sm text-zinc-500 mb-4">Validando período…</p>
        ) : validation ? (
          <div className="mb-6 space-y-3">
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 p-3">
                <p className="font-semibold text-emerald-900 dark:text-emerald-100">Compras</p>
                <p>Comprobantes: {validation.compras.comprobantes}</p>
                <p>Alícuotas: {validation.compras.alicuotas}</p>
                <p>Neto: {money(validation.compras.netoGravado)}</p>
                <p>IVA crédito: {money(validation.compras.iva)}</p>
              </div>
              <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 p-3">
                <p className="font-semibold text-blue-900 dark:text-blue-100">Ventas</p>
                <p>Comprobantes: {validation.ventas.comprobantes}</p>
                <p>Alícuotas: {validation.ventas.alicuotas}</p>
                <p>Neto: {money(validation.ventas.netoGravado)}</p>
                <p>IVA débito: {money(validation.ventas.iva)}</p>
              </div>
            </div>
            {validation.warnings.length > 0 ? (
              <ul className="text-sm rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-1 list-disc pl-5">
                {validation.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-emerald-700 dark:text-emerald-300">Sin advertencias.</p>
            )}
            <button type="button" onClick={() => void loadValidation()} className="text-xs text-emerald-600 hover:underline">
              Revalidar
            </button>
          </div>
        ) : null}

        <div className="space-y-4">
          <ArcaModuleCard
            title="Libro Compras"
            menu={ARCA_IMPORT_GUIDE.compras.menu}
            labelCbte={ARCA_IMPORT_GUIDE.compras.labelComprobantes}
            labelAli={ARCA_IMPORT_GUIDE.compras.labelAlicuotas}
            archivos={[
              { id: "compras_cbte", name: ARCA_FILE_NAMES.comprasCbte },
              { id: "compras_ali", name: ARCA_FILE_NAMES.comprasAli },
            ]}
            buttonClass="bg-emerald-700 hover:bg-emerald-800"
            exporting={p.exporting}
            onDownload={p.onDownloadArchivo}
          />
          <ArcaModuleCard
            title="Libro Ventas"
            menu={ARCA_IMPORT_GUIDE.ventas.menu}
            labelCbte={ARCA_IMPORT_GUIDE.ventas.labelComprobantes}
            labelAli={ARCA_IMPORT_GUIDE.ventas.labelAlicuotas}
            archivos={[
              { id: "ventas_cbte", name: ARCA_FILE_NAMES.ventasCbte },
              { id: "ventas_ali", name: ARCA_FILE_NAMES.ventasAli },
            ]}
            buttonClass="bg-blue-700 hover:bg-blue-800"
            exporting={p.exporting}
            onDownload={p.onDownloadArchivo}
          />
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-600 p-4">
            <h3 className="font-medium text-sm mb-1">Descargar los 4 archivos ARCA</h3>
            <p className="text-xs text-zinc-500 mb-3">
              Baja en secuencia los cuatro .txt listos para importar (2 compras + 2 ventas).
            </p>
            <button
              type="button"
              onClick={() => p.onDownloadTodos()}
              disabled={p.exporting}
              className="rounded-lg bg-slate-800 text-white px-4 py-2 text-sm font-medium hover:bg-slate-900 disabled:opacity-50"
            >
              {p.exporting ? "Descargando…" : "Descargar los 4 TXT"}
            </button>
            <button
              type="button"
              onClick={() => p.solicitarAlertasEscritorio()}
              className="ml-3 rounded-lg border px-4 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-700/60"
            >
              Avisos de escritorio
            </button>
          </div>

          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20 p-4">
            <h3 className="font-medium text-sm mb-1">Ingresos brutos · CM05</h3>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-3">
              Planilla Excel del mes para SIFERE (convenio multilateral). Impulsa jurisdicción 902
              (Buenos Aires) por defecto.
            </p>
            <button
              type="button"
              onClick={() => p.onDownloadCm05()}
              disabled={p.exportingCm05}
              className="rounded-lg bg-amber-700 text-white px-4 py-2 text-sm font-medium hover:bg-amber-800 disabled:opacity-50"
            >
              {p.exportingCm05
                ? "Generando…"
                : `Exportar CM05 ${p.month.padStart(2, "0")}/${p.year}`}
            </button>
          </div>

          {p.isIndividual ? <RegimenSimplificadoCard /> : null}
        </div>
      </div>

      <VencimientosBlock {...p} />
    </div>
  );
}

function ArcaModuleCard(props: {
  title: string;
  menu: string;
  labelCbte: string;
  labelAli: string;
  archivos: { id: ArcaArchivoId; name: string }[];
  buttonClass: string;
  exporting: boolean;
  onDownload: (id: ArcaArchivoId) => void;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-600 p-4">
      <h3 className="font-medium text-sm mb-1">{props.title}</h3>
      <p className="text-xs text-zinc-500 mb-3">
        {props.menu}
      </p>
      <div className="space-y-2">
        {props.archivos.map((a, i) => (
          <div key={a.id} className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-mono text-zinc-600 dark:text-zinc-400 flex-1 min-w-[200px]">
              {i === 0 ? props.labelCbte : props.labelAli}: {a.name}
            </span>
            <button
              type="button"
              onClick={() => props.onDownload(a.id)}
              disabled={props.exporting}
              className={`rounded-lg text-white px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${props.buttonClass}`}
            >
              Descargar
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function RegimenSimplificadoCard() {
  return (
    <details className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-950/20 p-4">
      <summary className="cursor-pointer font-medium text-sm text-indigo-900 dark:text-indigo-100">
        Ingresos brutos · Régimen Simplificado (referencia)
      </summary>
      <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-2 mb-3">
        Cuota fija mensual según facturación anual, para cuando pases de Convenio Multilateral a
        Régimen Simplificado. Valores de referencia: verificá los montos oficiales vigentes antes de
        pagar o cambiar de régimen — no se descargan de acá, es solo una tabla orientativa.
      </p>
      <div className="overflow-x-auto rounded-lg border border-indigo-200 dark:border-indigo-800">
        <table className="w-full text-xs min-w-[360px]">
          <thead>
            <tr className="text-left border-b bg-indigo-100/60 dark:bg-indigo-900/30">
              <th className="py-1.5 px-2">Categoría</th>
              <th className="py-1.5 px-2 text-right">Facturación anual hasta</th>
              <th className="py-1.5 px-2 text-right">Cuota mensual</th>
            </tr>
          </thead>
          <tbody>
            {REGIMEN_SIMPLIFICADO_CATEGORIAS.map((c) => (
              <tr key={c.categoria} className="border-b border-indigo-100 dark:border-indigo-900/50">
                <td className="py-1 px-2">{c.categoria}</td>
                <td className="py-1 px-2 text-right">{money(c.facturacionAnualHasta)}</td>
                <td className="py-1 px-2 text-right">{money(c.cuotaMensual)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function VencimientosBlock(p: {
  ultimoDigitoInput: string;
  setUltimoDigitoInput: Dispatch<SetStateAction<string>>;
  cuitCompletoOpcional: string;
  setCuitCompletoOpcional: Dispatch<SetStateAction<string>>;
  loadLibroVencimientos: () => void;
  libroAviso: string;
  libroItems: VencRow[];
}) {
  return (
    <div className="rounded-xl bg-white dark:bg-zinc-800 border p-6 shadow-sm">
      <h2 className="text-lg font-semibold mb-1">Vencimientos Libro IVA (orientativo)</h2>
      <div className="flex flex-wrap gap-4 items-end mb-4 mt-4">
        <label className="flex flex-col gap-1 text-sm">
          Último dígito CUIT
          <input
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={p.ultimoDigitoInput}
            onChange={(e) => p.setUltimoDigitoInput(e.target.value.replace(/\D/g, "").slice(0, 1))}
            className="rounded-lg border px-3 py-2 w-20"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm flex-1 min-w-[12rem] max-w-md">
          CUIT completo (opcional)
          <input
            value={p.cuitCompletoOpcional}
            onChange={(e) => p.setCuitCompletoOpcional(e.target.value.replace(/[^\d-]/g, "").slice(0, 13))}
            className="rounded-lg border px-3 py-2 font-mono text-xs"
          />
        </label>
        <button type="button" className="text-sm text-emerald-600 hover:underline pb-2" onClick={() => p.loadLibroVencimientos()}>
          Actualizar
        </button>
      </div>
      {p.libroAviso ? <p className="text-xs text-amber-800 mb-3 rounded bg-amber-500/10 border p-2">{p.libroAviso}</p> : null}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="text-left border-b bg-zinc-50 dark:bg-zinc-900/50 text-zinc-500">
              <th className="py-2.5 px-3">Período</th>
              <th className="py-2.5 px-3">Fecha ref.</th>
              <th className="py-2.5 px-3">Días</th>
            </tr>
          </thead>
          <tbody>
            {p.libroItems.map((row) => (
              <tr key={`${row.periodo.key}-lib`} className="border-b">
                <td className="py-2 px-3">
                  {row.periodo.month}/{row.periodo.year}
                </td>
                <td className="py-2 px-3 font-mono text-xs">{row.fechaReferenciaOrientativaISO}</td>
                <td className="py-2 px-3">{row.diasHastaOrientativo ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
