/** Códigos de jurisdicción SIFERE / Convenio Multilateral (columna Excel). */
export const CM05_JURISDICCIONES = [
  { code: "901", label: "CABA", col: "F" },
  { code: "902", label: "BS.AS.", col: "G" },
  { code: "903", label: "CATAM", col: "H" },
  { code: "904", label: "CORDOBA", col: "I" },
  { code: "905", label: "CORRIEN", col: "J" },
  { code: "906", label: "CHACO", col: "K" },
  { code: "907", label: "CHUBUT", col: "L" },
  { code: "908", label: "E. RIOS", col: "M" },
  { code: "909", label: "FORMOSA", col: "N" },
  { code: "910", label: "JUJUY", col: "O" },
  { code: "911", label: "LA PAMPA", col: "P" },
  { code: "912", label: "LA RIOJA", col: "Q" },
  { code: "913", label: "MENDOZA", col: "R" },
  { code: "914", label: "MISIONES", col: "S" },
  { code: "915", label: "NEUQUEN", col: "T" },
  { code: "916", label: "RIO NEGRO", col: "U" },
  { code: "917", label: "SALTA", col: "V" },
  { code: "918", label: "SAN JUAN", col: "W" },
  { code: "919", label: "SAN LUIS", col: "X" },
  { code: "920", label: "S. CRUZ", col: "Y" },
  { code: "921", label: "SANTA FE", col: "Z" },
  { code: "922", label: "S. ESTERO", col: "AA" },
  { code: "923", label: "T. FUEGO", col: "AB" },
  { code: "924", label: "TUCUMAN", col: "AC" },
] as const;

export type Cm05JurisdiccionCode = (typeof CM05_JURISDICCIONES)[number]["code"];

/** Columna "NO COMPUTABLE" del modelo ARCA. */
export const CM05_NO_COMPUTABLE_COL = "E";

/** Sede fiscal Notificas SRL (San Nicolás, Buenos Aires). */
export const CM05_DEFAULT_JURISDICCION: Cm05JurisdiccionCode = "902";

export function isCm05Jurisdiccion(code: string): code is Cm05JurisdiccionCode {
  return CM05_JURISDICCIONES.some((j) => j.code === code);
}

export function jurisdiccionCol(code: Cm05JurisdiccionCode): string {
  const found = CM05_JURISDICCIONES.find((j) => j.code === code);
  if (!found) throw new Error(`Jurisdicción inválida: ${code}`);
  return found.col;
}
