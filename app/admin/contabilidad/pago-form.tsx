"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  computePagoAlerts,
  isVatComputableInvoiceType,
  suggestVat21FromTotal,
  NOTIFICAS_CUIT,
  NOTIFICAS_RAZON_SOCIAL,
  TAX_SUBCATEGORY_LABELS,
  TAX_SUBCATEGORY_DEDUCTIBLE,
  TAX_SUBCATEGORIES,
} from "@/lib/accounting/pago-fiscal";

export type PagoFormState = {
  fecha: string;
  importe: string;
  concepto: string;
  proveedor: string;
  medio: string;
  facturaId: string;
  observaciones: string;
  invoiceType: string;
  posNumber: string;
  invoiceNumber: string;
  supplierCuit: string;
  supplierName: string;
  supplierVatCondition: string;
  invoiceDate: string;
  paymentDate: string;
  totalAmount: string;
  netTaxedAmount: string;
  vat21Amount: string;
  vat105Amount: string;
  vat27Amount: string;
  exemptAmount: string;
  vatPerceptionAmount: string;
  grossIncomePerceptionAmount: string;
  otherTaxesAmount: string;
  accountingCategory: string;
  taxSubcategory: string;
  paidBy: string;
  isVatComputable: boolean;
  isIncomeTaxDeductible: boolean;
  issuedToCompany: boolean | null;
  pdfStoragePath: string;
};

export function emptyPagoForm(): PagoFormState {
  const today = new Date().toISOString().slice(0, 10);
  return {
    fecha: today,
    importe: "",
    concepto: "",
    proveedor: "",
    medio: "transferencia",
    facturaId: "",
    observaciones: "",
    invoiceType: "",
    posNumber: "",
    invoiceNumber: "",
    supplierCuit: "",
    supplierName: "",
    supplierVatCondition: "",
    invoiceDate: "",
    paymentDate: today,
    totalAmount: "",
    netTaxedAmount: "",
    vat21Amount: "",
    vat105Amount: "",
    vat27Amount: "",
    exemptAmount: "",
    vatPerceptionAmount: "",
    grossIncomePerceptionAmount: "",
    otherTaxesAmount: "",
    accountingCategory: "",
    taxSubcategory: "",
    paidBy: "",
    isVatComputable: false,
    isIncomeTaxDeductible: false,
    issuedToCompany: null,
    pdfStoragePath: "",
  };
}

export function pagoFormFromRecord(row: Record<string, unknown>): PagoFormState {
  return {
    fecha: String(row.paymentDate ?? row.fecha ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10),
    importe: String(row.totalAmount ?? row.importe ?? ""),
    concepto: String(row.concepto ?? ""),
    proveedor: String(row.supplierName ?? row.proveedor ?? ""),
    medio: String(row.paymentMethod ?? row.medio ?? "transferencia"),
    facturaId: String(row.facturaId ?? ""),
    observaciones: String(row.notes ?? row.observaciones ?? ""),
    invoiceType: String(row.invoiceType ?? ""),
    posNumber: String(row.posNumber ?? ""),
    invoiceNumber: String(row.invoiceNumber ?? ""),
    supplierCuit: String(row.supplierCuit ?? ""),
    supplierName: String(row.supplierName ?? row.proveedor ?? ""),
    supplierVatCondition: String(row.supplierVatCondition ?? ""),
    invoiceDate: String(row.invoiceDate ?? "").slice(0, 10),
    paymentDate: String(row.paymentDate ?? row.fecha ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10),
    totalAmount: String(row.totalAmount ?? row.importe ?? ""),
    netTaxedAmount: String(row.netTaxedAmount ?? ""),
    vat21Amount: String(row.vat21Amount ?? ""),
    vat105Amount: String(row.vat105Amount ?? ""),
    vat27Amount: String(row.vat27Amount ?? ""),
    exemptAmount: String(row.exemptAmount ?? ""),
    vatPerceptionAmount: String(row.vatPerceptionAmount ?? ""),
    grossIncomePerceptionAmount: String(row.grossIncomePerceptionAmount ?? ""),
    otherTaxesAmount: String(row.otherTaxesAmount ?? ""),
    accountingCategory: String(row.accountingCategory ?? ""),
    taxSubcategory: String(row.taxSubcategory ?? ""),
    paidBy: String(row.paidBy ?? ""),
    isVatComputable: row.isVatComputable === true,
    isIncomeTaxDeductible: row.isIncomeTaxDeductible === true,
    issuedToCompany: row.issuedToCompany === true ? true : row.issuedToCompany === false ? false : null,
    pdfStoragePath: String(row.pdfStoragePath ?? ""),
  };
}

export function pagoFormFromExtract(extracted: Record<string, unknown>): PagoFormState {
  const base = emptyPagoForm();
  const merged = { ...base, ...pagoFormFromRecord(extracted) };
  if (extracted.pdfStoragePath) merged.pdfStoragePath = String(extracted.pdfStoragePath);
  if (extracted.isVatComputable === true) merged.isVatComputable = true;
  if (extracted.issuedToCompany === true) merged.issuedToCompany = true;
  else if (extracted.issuedToCompany === false) merged.issuedToCompany = false;
  return merged;
}

function parseNum(s: string): number {
  const n = Number(String(s).replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

function FormSection(props: { title: string; children: ReactNode }) {
  return (
    <fieldset className="sm:col-span-2 rounded-lg border border-zinc-200 dark:border-zinc-600 p-4 space-y-4">
      <legend className="px-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">{props.title}</legend>
      <div className="grid sm:grid-cols-2 gap-4">{props.children}</div>
    </fieldset>
  );
}

function FieldLabel(props: {
  label: string;
  required?: boolean;
  span?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 text-sm ${props.span ? "sm:col-span-2" : ""}`}>
      {props.label}
      {props.required ? " *" : ""}
      {props.children}
    </label>
  );
}

const inputCls =
  "rounded-lg border px-3 py-2 bg-white dark:bg-zinc-700 border-zinc-300 dark:border-zinc-600";

export function PagoForm(props: {
  form: PagoFormState;
  setForm: React.Dispatch<React.SetStateAction<PagoFormState>>;
  editId: string | null;
  saving: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  receiverCuitDetected?: string | null;
  companyLabel?: string;
  companyCuit?: string;
}) {
  const { form, setForm, editId, saving, onSubmit, onCancel, receiverCuitDetected } = props;
  const companyLabel = props.companyLabel ?? NOTIFICAS_RAZON_SOCIAL;
  const companyCuit = props.companyCuit ?? NOTIFICAS_CUIT;
  const issuedToCompanyOption = companyCuit.trim()
    ? `Sí (${companyLabel} — CUIT ${companyCuit})`
    : `Sí (${companyLabel})`;
  const showVatFields = form.invoiceType === "factura_a";

  const alerts = useMemo(() => {
    return computePagoAlerts({
      isVatComputable: form.isVatComputable,
      invoiceType: (form.invoiceType || null) as import("@/lib/accounting/pago-fiscal").InvoiceType | null,
      supplierCuit: form.supplierCuit,
      posNumber: form.posNumber,
      invoiceNumber: form.invoiceNumber,
      issuedToCompany: form.issuedToCompany,
      netTaxedAmount: parseNum(form.netTaxedAmount) || 0,
      vat21Amount: parseNum(form.vat21Amount) || 0,
      vat105Amount: parseNum(form.vat105Amount) || 0,
      vat27Amount: parseNum(form.vat27Amount) || 0,
      paidBy: (form.paidBy || null) as import("@/lib/accounting/pago-fiscal").PaidBy | null,
      receiverCuitDetected,
    });
  }, [form, receiverCuitDetected]);

  const suggestVat = () => {
    const total = parseNum(form.totalAmount || form.importe);
    if (Number.isNaN(total) || total <= 0) return;
    const { netTaxedAmount, vat21Amount } = suggestVat21FromTotal(total);
    setForm((s) => ({
      ...s,
      netTaxedAmount: String(netTaxedAmount),
      vat21Amount: String(vat21Amount),
    }));
  };

  const syncTotal = (total: string) => {
    setForm((s) => ({ ...s, totalAmount: total, importe: total }));
  };

  return (
    <form className="grid sm:grid-cols-2 gap-4 pt-4" onSubmit={onSubmit}>
      {alerts.length > 0 && (
        <div className="sm:col-span-2 space-y-2">
          {alerts.map((a, i) => (
            <div
              key={i}
              className={`text-sm rounded-lg px-4 py-3 border ${
                a.level === "error"
                  ? "bg-red-50 border-red-200 text-red-800 dark:bg-red-950/40 dark:border-red-800 dark:text-red-200"
                  : a.level === "warning"
                    ? "bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-100"
                    : "bg-blue-50 border-blue-200 text-blue-900 dark:bg-blue-950/40 dark:border-blue-800 dark:text-blue-100"
              }`}
            >
              {a.message}
            </div>
          ))}
        </div>
      )}

      <FormSection title="Datos generales del gasto">
        <FieldLabel label="Concepto" required>
          <input
            required
            value={form.concepto}
            onChange={(e) => setForm((s) => ({ ...s, concepto: e.target.value }))}
            className={inputCls}
          />
        </FieldLabel>
        <FieldLabel label="Categoría contable">
          <select
            value={form.accountingCategory}
            onChange={(e) => {
              const cat = e.target.value;
              setForm((s) => ({
                ...s,
                accountingCategory: cat,
                taxSubcategory: cat !== "impuestos" ? "" : s.taxSubcategory,
              }));
            }}
            className={inputCls}
          >
            <option value="">— Seleccionar —</option>
            <option value="insumos">Insumos</option>
            <option value="servicios">Servicios</option>
            <option value="honorarios">Honorarios</option>
            <option value="alquiler">Alquiler</option>
            <option value="sueldos">Sueldos</option>
            <option value="impuestos">Impuestos</option>
            <option value="equipamiento">Equipamiento</option>
            <option value="marketing">Marketing</option>
            <option value="aporte_reintegro_socio">Aporte / reintegro socio</option>
            <option value="otro">Otro</option>
          </select>
        </FieldLabel>
        {form.accountingCategory === "impuestos" ? (
          <FieldLabel label="Tipo de impuesto">
            <select
              value={form.taxSubcategory}
              onChange={(e) => {
                const sub = e.target.value as keyof typeof TAX_SUBCATEGORY_DEDUCTIBLE | "";
                setForm((s) => ({
                  ...s,
                  taxSubcategory: sub,
                  isIncomeTaxDeductible: sub ? TAX_SUBCATEGORY_DEDUCTIBLE[sub as keyof typeof TAX_SUBCATEGORY_DEDUCTIBLE] : s.isIncomeTaxDeductible,
                  invoiceType: !s.invoiceType && sub ? "vep" : s.invoiceType,
                  supplierName: !s.supplierName && sub ? "AFIP - ARCA" : s.supplierName,
                  proveedor: !s.proveedor && sub ? "AFIP - ARCA" : s.proveedor,
                }));
              }}
              className={inputCls}
            >
              <option value="">— Seleccionar —</option>
              {TAX_SUBCATEGORIES.map((sc) => (
                <option key={sc} value={sc}>
                  {TAX_SUBCATEGORY_LABELS[sc]}
                  {TAX_SUBCATEGORY_DEDUCTIBLE[sc] ? " ✓ deducible" : ""}
                </option>
              ))}
            </select>
          </FieldLabel>
        ) : null}
      </FormSection>

      <FormSection title="Datos del comprobante">
        <FieldLabel label="Tipo de comprobante" required>
          <select
            required
            value={form.invoiceType}
            onChange={(e) => {
              const v = e.target.value;
              setForm((s) => ({
                ...s,
                invoiceType: v,
                isVatComputable: v === "factura_a" ? s.isVatComputable : false,
              }));
            }}
            className={inputCls}
          >
            <option value="">— Seleccionar —</option>
            <option value="factura_a">Factura A</option>
            <option value="factura_b">Factura B</option>
            <option value="factura_c">Factura C</option>
            <option value="ticket">Ticket</option>
            <option value="recibo">Recibo</option>
            <option value="vep">VEP (pago de impuesto)</option>
            <option value="sin_comprobante">Sin comprobante</option>
            <option value="otro">Otro</option>
          </select>
        </FieldLabel>
        <FieldLabel label="Condición IVA proveedor">
          <select
            value={form.supplierVatCondition}
            onChange={(e) => setForm((s) => ({ ...s, supplierVatCondition: e.target.value }))}
            className={inputCls}
          >
            <option value="">—</option>
            <option value="responsable_inscripto">Responsable inscripto</option>
            <option value="monotributo">Monotributo</option>
            <option value="exento">Exento</option>
            <option value="consumidor_final">Consumidor final</option>
            <option value="otro">Otro</option>
          </select>
        </FieldLabel>
        <FieldLabel label="Punto de venta" required={showVatFields}>
          <input
            value={form.posNumber}
            onChange={(e) => setForm((s) => ({ ...s, posNumber: e.target.value }))}
            className={inputCls}
            placeholder="Ej. 00001"
          />
        </FieldLabel>
        <FieldLabel label="Número de comprobante" required={showVatFields}>
          <input
            value={form.invoiceNumber}
            onChange={(e) => setForm((s) => ({ ...s, invoiceNumber: e.target.value }))}
            className={inputCls}
          />
        </FieldLabel>
        <FieldLabel label="CUIT proveedor" required={showVatFields}>
          <input
            value={form.supplierCuit}
            onChange={(e) => setForm((s) => ({ ...s, supplierCuit: e.target.value }))}
            className={inputCls}
            placeholder="11 dígitos"
          />
        </FieldLabel>
        <FieldLabel label="Razón social proveedor" required={Boolean(form.invoiceType)}>
          <input
            value={form.supplierName || form.proveedor}
            onChange={(e) =>
              setForm((s) => ({ ...s, supplierName: e.target.value, proveedor: e.target.value }))
            }
            className={inputCls}
          />
        </FieldLabel>
        <FieldLabel label="Fecha del comprobante" required={showVatFields}>
          <input
            type="date"
            value={form.invoiceDate}
            onChange={(e) => setForm((s) => ({ ...s, invoiceDate: e.target.value }))}
            className={inputCls}
          />
        </FieldLabel>
        <FieldLabel label={`Emitido a nombre de ${companyLabel}`}>
          <select
            value={form.issuedToCompany === null ? "" : form.issuedToCompany ? "si" : "no"}
            onChange={(e) =>
              setForm((s) => ({
                ...s,
                issuedToCompany: e.target.value === "" ? null : e.target.value === "si",
              }))
            }
            className={inputCls}
          >
            <option value="">— Sin verificar —</option>
            <option value="si">{issuedToCompanyOption}</option>
            <option value="no">No / otro receptor</option>
          </select>
        </FieldLabel>
      </FormSection>

      {showVatFields && (
        <FormSection title="Impuestos / IVA">
          <FieldLabel label="Importe total" required>
            <input
              required
              value={form.totalAmount || form.importe}
              onChange={(e) => syncTotal(e.target.value)}
              className={inputCls}
            />
          </FieldLabel>
          <div className="flex items-end">
            <button
              type="button"
              onClick={suggestVat}
              className="text-sm text-violet-600 hover:underline dark:text-violet-400"
            >
              Calcular neto + IVA 21% desde total
            </button>
          </div>
          <FieldLabel label="Neto gravado">
            <input
              value={form.netTaxedAmount}
              onChange={(e) => setForm((s) => ({ ...s, netTaxedAmount: e.target.value }))}
              className={inputCls}
            />
          </FieldLabel>
          <FieldLabel label="IVA 21%">
            <input
              value={form.vat21Amount}
              onChange={(e) => setForm((s) => ({ ...s, vat21Amount: e.target.value }))}
              className={inputCls}
            />
          </FieldLabel>
          <FieldLabel label="IVA 10,5%">
            <input
              value={form.vat105Amount}
              onChange={(e) => setForm((s) => ({ ...s, vat105Amount: e.target.value }))}
              className={inputCls}
            />
          </FieldLabel>
          <FieldLabel label="IVA 27%">
            <input
              value={form.vat27Amount}
              onChange={(e) => setForm((s) => ({ ...s, vat27Amount: e.target.value }))}
              className={inputCls}
            />
          </FieldLabel>
          <FieldLabel label="Exento / no gravado">
            <input
              value={form.exemptAmount}
              onChange={(e) => setForm((s) => ({ ...s, exemptAmount: e.target.value }))}
              className={inputCls}
            />
          </FieldLabel>
          <FieldLabel label="Percepciones IVA">
            <input
              value={form.vatPerceptionAmount}
              onChange={(e) => setForm((s) => ({ ...s, vatPerceptionAmount: e.target.value }))}
              className={inputCls}
            />
          </FieldLabel>
          <FieldLabel label="Percepciones IIBB">
            <input
              value={form.grossIncomePerceptionAmount}
              onChange={(e) => setForm((s) => ({ ...s, grossIncomePerceptionAmount: e.target.value }))}
              className={inputCls}
            />
          </FieldLabel>
          <FieldLabel label="Otros impuestos">
            <input
              value={form.otherTaxesAmount}
              onChange={(e) => setForm((s) => ({ ...s, otherTaxesAmount: e.target.value }))}
              className={inputCls}
            />
          </FieldLabel>
          <label className="sm:col-span-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isVatComputable}
              disabled={!isVatComputableInvoiceType(form.invoiceType as import("@/lib/accounting/pago-fiscal").InvoiceType)}
              onChange={(e) => setForm((s) => ({ ...s, isVatComputable: e.target.checked }))}
            />
            Computable para IVA (crédito fiscal)
          </label>
        </FormSection>
      )}

      {!showVatFields && (
        <FormSection title="Importe">
          <FieldLabel label="Importe total" required>
            <input
              required
              value={form.totalAmount || form.importe}
              onChange={(e) => syncTotal(e.target.value)}
              className={inputCls}
            />
          </FieldLabel>
        </FormSection>
      )}

      <FormSection title="Contabilidad y pago">
        <FieldLabel label="Fecha de pago" required>
          <input
            type="date"
            required
            value={form.paymentDate || form.fecha}
            onChange={(e) =>
              setForm((s) => ({ ...s, paymentDate: e.target.value, fecha: e.target.value }))
            }
            className={inputCls}
          />
        </FieldLabel>
        <FieldLabel label="Medio de pago">
          <select
            value={form.medio}
            onChange={(e) => setForm((s) => ({ ...s, medio: e.target.value }))}
            className={inputCls}
          >
            <option value="transferencia">Transferencia</option>
            <option value="efectivo">Efectivo</option>
            <option value="cheque">Cheque</option>
            <option value="tarjeta">Tarjeta</option>
            <option value="otro">Otro</option>
          </select>
        </FieldLabel>
        <FieldLabel label="Pagado por">
          <select
            value={form.paidBy}
            onChange={(e) => {
              const v = e.target.value;
              setForm((s) => ({
                ...s,
                paidBy: v,
                accountingCategory:
                  v === "tarjeta_personal_socio" || v === "efectivo_socio"
                    ? s.accountingCategory || "aporte_reintegro_socio"
                    : s.accountingCategory,
              }));
            }}
            className={inputCls}
          >
            <option value="">—</option>
            <option value="cuenta_empresa">Cuenta empresa</option>
            <option value="tarjeta_empresa">Tarjeta empresa</option>
            <option value="tarjeta_personal_socio">Tarjeta personal socio</option>
            <option value="efectivo_socio">Efectivo socio</option>
            <option value="otro">Otro</option>
          </select>
        </FieldLabel>
        <FieldLabel label="Id factura vinculada (opcional)">
          <input
            value={form.facturaId}
            onChange={(e) => setForm((s) => ({ ...s, facturaId: e.target.value }))}
            className={`${inputCls} font-mono text-xs`}
          />
        </FieldLabel>
        <label className="sm:col-span-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.isIncomeTaxDeductible}
            onChange={(e) => setForm((s) => ({ ...s, isIncomeTaxDeductible: e.target.checked }))}
          />
          Computable para Ganancias
        </label>
      </FormSection>

      <FormSection title="Archivo PDF adjunto">
        <FieldLabel label="Ruta PDF en Storage" span>
          <input
            value={form.pdfStoragePath}
            readOnly
            className={`${inputCls} font-mono text-xs bg-zinc-50 dark:bg-zinc-800`}
            placeholder="Se completa al cargar PDF + IA"
          />
        </FieldLabel>
        <FieldLabel label="Observaciones" span>
          <textarea
            rows={3}
            value={form.observaciones}
            onChange={(e) => setForm((s) => ({ ...s, observaciones: e.target.value }))}
            className={inputCls}
          />
        </FieldLabel>
      </FormSection>

      <div className="sm:col-span-2 flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-emerald-600 text-white px-5 py-2 font-medium hover:bg-emerald-700 disabled:opacity-50"
        >
          {saving ? "Guardando…" : editId ? "Actualizar gasto" : "Guardar gasto"}
        </button>
        {editId && (
          <button type="button" className="border rounded-lg px-5 py-2" onClick={onCancel}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}

export function buildPagoSubmitBody(form: PagoFormState): Record<string, unknown> {
  const num = (s: string) => {
    const t = s.trim();
    if (!t) return 0;
    const n = parseNum(t);
    return Number.isNaN(n) ? 0 : n;
  };

  const total = num(form.totalAmount || form.importe);
  const paymentDate = form.paymentDate || form.fecha;

  return {
    fecha: paymentDate,
    importe: total,
    concepto: form.concepto.trim(),
    proveedor: (form.supplierName || form.proveedor).trim() || undefined,
    medio: form.medio || undefined,
    facturaId: form.facturaId.trim() || undefined,
    observaciones: form.observaciones.trim() || undefined,
    invoiceType: form.invoiceType || null,
    posNumber: form.posNumber.trim() || undefined,
    invoiceNumber: form.invoiceNumber.trim() || undefined,
    supplierCuit: form.supplierCuit.trim() || undefined,
    supplierName: (form.supplierName || form.proveedor).trim() || undefined,
    supplierVatCondition: form.supplierVatCondition || null,
    invoiceDate: form.invoiceDate.trim() || null,
    paymentDate,
    totalAmount: total,
    netTaxedAmount: num(form.netTaxedAmount),
    vat21Amount: num(form.vat21Amount),
    vat105Amount: num(form.vat105Amount),
    vat27Amount: num(form.vat27Amount),
    exemptAmount: num(form.exemptAmount),
    vatPerceptionAmount: num(form.vatPerceptionAmount),
    grossIncomePerceptionAmount: num(form.grossIncomePerceptionAmount),
    otherTaxesAmount: num(form.otherTaxesAmount),
    accountingCategory: form.accountingCategory || null,
    taxSubcategory: form.accountingCategory === "impuestos" ? (form.taxSubcategory || null) : null,
    paymentMethod: form.medio || undefined,
    paidBy: form.paidBy || null,
    isVatComputable: form.isVatComputable,
    isIncomeTaxDeductible: form.isIncomeTaxDeductible,
    issuedToCompany: form.issuedToCompany,
    pdfStoragePath: form.pdfStoragePath.trim() || null,
    notes: form.observaciones.trim() || undefined,
  };
}
