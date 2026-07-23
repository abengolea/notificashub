export type TabId =
  | "panel"
  | "cobros"
  | "pagos"
  | "facturas"
  | "importar"
  | "arca"
  | "auditoria"
  | "ganancias"
  | "bienes";

export const CONTAB_TABS: {
  id: TabId;
  label: string;
  hint: string;
  group: "operacion" | "impuestos";
  /** Si está presente, la pestaña solo se muestra cuando la entidad cumple la condición. */
  requiresIndividual?: boolean;
}[] = [
  { id: "panel", label: "Resumen", hint: "Cómo va el mes", group: "operacion" },
  { id: "importar", label: "Cargar datos", hint: "ARCA, banco, MP", group: "operacion" },
  { id: "facturas", label: "Facturas", hint: "Libro compras/ventas", group: "operacion" },
  { id: "cobros", label: "Cobros", hint: "Dinero que entra", group: "operacion" },
  { id: "pagos", label: "Gastos", hint: "Dinero que sale", group: "operacion" },
  { id: "arca", label: "Declarar", hint: "Exportar a ARCA", group: "impuestos" },
  { id: "auditoria", label: "Revisar IVA", hint: "Qué entra al libro", group: "impuestos" },
  { id: "ganancias", label: "Ganancias", hint: "Resultado del año", group: "impuestos" },
  {
    id: "bienes",
    label: "Bienes Personales",
    hint: "Patrimonio al 31/12",
    group: "impuestos",
    requiresIndividual: true,
  },
];

export function periodLabel(
  month: string,
  year: string,
  months: { v: string; label: string }[]
): string {
  const m = months.find((x) => x.v === month);
  return `${m?.label ?? month} ${year}`;
}
