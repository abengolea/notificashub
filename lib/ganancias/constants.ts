import type { DeduccionCategoria } from "@/lib/accounting/schemas";

export const DEDUCCION_PERSONAL_CATEGORIES: readonly DeduccionCategoria[] = [
  "obra_social",
  "honorarios_medicos",
  "alquiler_vivienda",
  "donaciones",
  "seguro_vida",
  "aportes_jubilatorios",
  "otro",
] as const;

export const DEDUCCION_CATEGORIA_LABELS: Record<DeduccionCategoria, string> = {
  obra_social: "Obra social / prepaga",
  honorarios_medicos: "Honorarios médicos",
  alquiler_vivienda: "Alquiler vivienda",
  donaciones: "Donaciones",
  seguro_vida: "Seguro de vida",
  aportes_jubilatorios: "Aportes jubilatorios voluntarios",
  otro: "Otra deducción personal",
};

export const MONTH_LABELS_ES = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
] as const;
