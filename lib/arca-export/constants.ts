/** Nombres oficiales de archivos Libro IVA Digital (AFIP / ARCA). */
export const ARCA_FILE_NAMES = {
  comprasCbte: "LIBRO_IVA_DIGITAL_COMPRAS_CBTE.txt",
  comprasAli: "LIBRO_IVA_DIGITAL_COMPRAS_ALICUOTAS.txt",
  ventasCbte: "LIBRO_IVA_DIGITAL_VENTAS_CBTE.txt",
  ventasAli: "LIBRO_IVA_DIGITAL_VENTAS_ALICUOTAS.txt",
} as const;

/** IDs para descarga individual (sin ZIP). */
export const ARCA_ARCHIVO_IDS = [
  "compras_cbte",
  "compras_ali",
  "ventas_cbte",
  "ventas_ali",
] as const;

export type ArcaArchivoId = (typeof ARCA_ARCHIVO_IDS)[number];

export const ARCA_ARCHIVO_LABELS: Record<ArcaArchivoId, string> = {
  compras_cbte: ARCA_FILE_NAMES.comprasCbte,
  compras_ali: ARCA_FILE_NAMES.comprasAli,
  ventas_cbte: ARCA_FILE_NAMES.ventasCbte,
  ventas_ali: ARCA_FILE_NAMES.ventasAli,
};

export type ArcaExportModo = "compras" | "ventas" | "todo" | "validate";

/** Pantallas ARCA donde se importa cada par de archivos. */
export const ARCA_IMPORT_GUIDE = {
  compras: {
    menu: "Libro IVA → Compras → Importar",
    archivoComprobantes: ARCA_FILE_NAMES.comprasCbte,
    archivoAlicuotas: ARCA_FILE_NAMES.comprasAli,
    labelComprobantes: "Archivo Compras",
    labelAlicuotas: "Archivo IVA Compras",
  },
  ventas: {
    menu: "Libro IVA → Ventas → Importar",
    archivoComprobantes: ARCA_FILE_NAMES.ventasCbte,
    archivoAlicuotas: ARCA_FILE_NAMES.ventasAli,
    labelComprobantes: "Archivo Ventas",
    labelAlicuotas: "Archivo IVA Ventas",
  },
} as const;
