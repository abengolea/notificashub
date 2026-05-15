/**
 * Node fetch suele lanzar TypeError("fetch failed") sin detalle; el motivo real va en `cause`.
 */
export function explainFetchFailure(url: string, e: unknown): string {
  const bits: string[] = [`POST ${url}`];

  function appendErr(err: unknown): void {
    if (err instanceof Error) {
      bits.push(err.message);
      const c = err.cause;
      if (c instanceof Error) {
        bits.push(`cause: ${c.message}`);
        const ne = c as NodeJS.ErrnoException & { hostname?: string; port?: number };
        if (ne.code) bits.push(`code: ${ne.code}`);
        if (ne.syscall) bits.push(`syscall: ${ne.syscall}`);
        if (ne.hostname) bits.push(`host: ${ne.hostname}`);
        if (typeof ne.port === "number") bits.push(`port: ${ne.port}`);
      } else if (c !== undefined) {
        bits.push(`cause: ${String(c)}`);
      }
    } else if (err !== undefined) {
      bits.push(String(err));
    }
  }

  appendErr(e);

  if (e instanceof AggregateError) {
    for (const [i, sub] of e.errors.entries()) {
      bits.push(`[${i}] ${sub instanceof Error ? sub.message : String(sub)}`);
    }
  }

  return bits.join(" | ");
}
