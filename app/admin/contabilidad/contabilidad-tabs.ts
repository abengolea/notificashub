export type TabId = "panel" | "cobros" | "pagos" | "facturas" | "importar" | "arca" | "auditoria";

export const CONTAB_TABS: { id: TabId; label: string; hint: string; group: "operacion" | "impuestos" }[] = [
  { id: "panel", label: "Panel", hint: "Resumen del mes", group: "operacion" },
  { id: "cobros", label: "Cobros", hint: "Entradas de dinero", group: "operacion" },
  { id: "pagos", label: "Pagos", hint: "Salidas y gastos", group: "operacion" },
  { id: "facturas", label: "Facturas", hint: "Compras y ventas", group: "operacion" },
  { id: "importar", label: "Importar", hint: "Banco y Mercado Pago", group: "operacion" },
  { id: "arca", label: "ARCA / IVA", hint: "Libro y vencimientos", group: "impuestos" },
  { id: "auditoria", label: "Auditoría IVA", hint: "Diagnóstico compras", group: "impuestos" },
];

export function periodLabel(
  month: string,
  year: string,
  months: { v: string; label: string }[]
): string {
  const m = months.find((x) => x.v === month);
  return `${m?.label ?? month} ${year}`;
}
