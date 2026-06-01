import {
  ARCA_ARCHIVO_IDS,
  ARCA_FILE_NAMES,
  type ArcaArchivoId,
} from "@/lib/arca-export/constants";
import {
  loadPeriodExportData,
  txtToLatin1Buffer,
  validateArcaExport,
  type PeriodExportData,
} from "@/lib/arca-export/period-export";

export type ArcaArchivoDownload = {
  buffer: Buffer;
  filename: string;
  contentType: string;
};

export function parseArcaArchivoId(raw: string | null): ArcaArchivoId | null {
  const s = (raw ?? "").trim().toLowerCase();
  return (ARCA_ARCHIVO_IDS as readonly string[]).includes(s) ? (s as ArcaArchivoId) : null;
}

/** Devuelve un archivo TXT listo para descarga directa (sin ZIP). */
export function getArcaArchivoDownload(data: PeriodExportData, id: ArcaArchivoId): ArcaArchivoDownload {
  switch (id) {
    case "compras_cbte":
      return {
        buffer: txtToLatin1Buffer(data.txt.comprasCbte),
        filename: ARCA_FILE_NAMES.comprasCbte,
        contentType: "text/plain; charset=windows-1252",
      };
    case "compras_ali":
      return {
        buffer: txtToLatin1Buffer(data.txt.comprasAli),
        filename: ARCA_FILE_NAMES.comprasAli,
        contentType: "text/plain; charset=windows-1252",
      };
    case "ventas_cbte":
      return {
        buffer: txtToLatin1Buffer(data.txt.ventasCbte),
        filename: ARCA_FILE_NAMES.ventasCbte,
        contentType: "text/plain; charset=windows-1252",
      };
    case "ventas_ali":
      return {
        buffer: txtToLatin1Buffer(data.txt.ventasAli),
        filename: ARCA_FILE_NAMES.ventasAli,
        contentType: "text/plain; charset=windows-1252",
      };
    default: {
      const _exhaustive: never = id;
      throw new Error(`Archivo no soportado: ${_exhaustive}`);
    }
  }
}

export function isComprasArchivo(id: ArcaArchivoId): boolean {
  return id === "compras_cbte" || id === "compras_ali";
}

export function isVentasArchivo(id: ArcaArchivoId): boolean {
  return id === "ventas_cbte" || id === "ventas_ali";
}

export { loadPeriodExportData, validateArcaExport, ARCA_ARCHIVO_IDS };
