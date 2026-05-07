/**
 * Lee `process.env[name]` tolerando claves mal copiadas en `.env`
 * (espacio o BOM delante del nombre del key; ocurre seguido en editores Windows).
 */
export function envTrimmedKey(name: string): string | undefined {
  const direct = process.env[name];
  if (direct !== undefined) {
    const t = String(direct).trim();
    if (t !== "") return t;
  }
  const oddKey = Object.keys(process.env).find((k) => k.replace(/^\uFEFF/u, "").trim() === name);
  if (oddKey !== undefined && process.env[oddKey] !== undefined) {
    const t = String(process.env[oddKey]).trim();
    if (t !== "") return t;
  }
  return undefined;
}

/** Primer nombre de la lista con valor no vacío (aliases de configuración). */
export function envFirstNonEmpty(...names: string[]): string | undefined {
  for (const name of names) {
    const v = envTrimmedKey(name);
    if (v) return v;
  }
  return undefined;
}

/** Valor que va en `access_token` del SDK (sin prefijo `Bearer ` si lo pegaste entero). */
export function normalizeAfipSdkAccessToken(raw: string): string {
  const t = raw.trim();
  if (t.toLowerCase().startsWith("bearer ")) return t.slice(7).trim();
  return t;
}
