/**
 * Referencia de categorías del Régimen Simplificado de Ingresos Brutos (cuota fija mensual
 * por banda de facturación anual), análogo a Monotributo pero para IIBB local/CABA-PBA.
 * Valores placeholder: verificar los montos oficiales vigentes antes de inscribirse o pagar,
 * cambian todos los años y difieren por jurisdicción.
 */
export type RegimenSimplificadoCategoria = {
  categoria: string;
  facturacionAnualHasta: number;
  cuotaMensual: number;
};

export const REGIMEN_SIMPLIFICADO_CATEGORIAS: readonly RegimenSimplificadoCategoria[] = [
  { categoria: "I", facturacionAnualHasta: 8_000_000, cuotaMensual: 15_000 },
  { categoria: "II", facturacionAnualHasta: 12_000_000, cuotaMensual: 25_000 },
  { categoria: "III", facturacionAnualHasta: 18_000_000, cuotaMensual: 40_000 },
  { categoria: "IV", facturacionAnualHasta: 26_000_000, cuotaMensual: 60_000 },
  { categoria: "V", facturacionAnualHasta: 36_000_000, cuotaMensual: 85_000 },
] as const;

export function regimenSimplificadoCategoriaPara(facturacionAnual: number): RegimenSimplificadoCategoria | null {
  return (
    REGIMEN_SIMPLIFICADO_CATEGORIAS.find((c) => facturacionAnual <= c.facturacionAnualHasta) ?? null
  );
}
