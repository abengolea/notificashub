export type CotizacionReferencia = {
  /** ARS por 1 USD (precio venta / vendedor según la fuente consultada). */
  venta: number;
  compra?: number;
  fuente: string;
  fechaActualizacionISO: string | null;
};

/**
 * Cotización “oficial” en JSON (referencia habitual al Banco Nación minorista).
 * Verificá el valor contra el BNA del día de emisión; podés sobrescribir el tipo en el panel.
 */
export async function fetchCotizacionDolarReferencia(): Promise<CotizacionReferencia> {
  const url = "https://dolarapi.com/v1/dolares/oficial";
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Cotización: HTTP ${res.status} ${t.slice(0, 200)}`);
  }
  const j = (await res.json()) as Record<string, unknown>;
  const venta = Number(j.venta);
  const compra = typeof j.compra === "number" ? j.compra : undefined;
  if (!Number.isFinite(venta) || venta <= 0) {
    throw new Error("Respuesta de cotización sin venta válida");
  }
  const fecha = typeof j.fechaActualizacion === "string" ? j.fechaActualizacion : null;
  return {
    venta,
    compra,
    fuente: "DolarAPI — dólar oficial (referencia; contrastar con BNA vendedor del día)",
    fechaActualizacionISO: fecha,
  };
}
