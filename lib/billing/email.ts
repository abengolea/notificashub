import { BILLING_EMISOR } from "@/lib/billing/constants";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function enviarMailFacturaRecurrente(opts: {
  to: string;
  clienteNombre: string;
  fechaISO: string;
  numeroComprobante: string;
  puntoVenta: string;
  neto: number;
  iva: number;
  total: number;
  observaciones: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.BILLING_EMAIL_FROM?.trim();
  if (!key || !from) {
    return {
      ok: false,
      error: "Falta RESEND_API_KEY o BILLING_EMAIL_FROM en el servidor",
    };
  }

  const money = (n: number) =>
    n.toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 });

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #111;">
  <p>Estimados/as <strong>${escapeHtml(opts.clienteNombre)}</strong>,</p>
  <p>Adjuntamos los datos de la factura emitida por <strong>${escapeHtml(BILLING_EMISOR.razonSocial)}</strong>.</p>
  <ul>
    <li><strong>Fecha:</strong> ${escapeHtml(opts.fechaISO)}</li>
    <li><strong>Comprobante:</strong> PV ${escapeHtml(opts.puntoVenta)} — N.º ${escapeHtml(opts.numeroComprobante)}</li>
    <li><strong>Neto gravado:</strong> ${escapeHtml(money(opts.neto))}</li>
    <li><strong>IVA 21%:</strong> ${escapeHtml(money(opts.iva))}</li>
    <li><strong>Total:</strong> ${escapeHtml(money(opts.total))}</li>
  </ul>
  <p style="white-space: pre-wrap; border-left: 3px solid #059669; padding-left: 12px; margin-top: 1.5rem;">
${escapeHtml(opts.observaciones)}
  </p>
  <p style="margin-top: 2rem; font-size: 0.9rem; color: #444;">
    ${escapeHtml(BILLING_EMISOR.razonSocial)}<br/>
    CUIT ${escapeHtml(BILLING_EMISOR.cuit)}<br/>
    ${escapeHtml(BILLING_EMISOR.domicilio)}
  </p>
</body>
</html>`.trim();

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [opts.to],
      subject: `Factura ${opts.puntoVenta}-${opts.numeroComprobante} — ${BILLING_EMISOR.razonSocial}`,
      html,
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return { ok: false, error: `Resend ${res.status}: ${t.slice(0, 400)}` };
  }
  return { ok: true };
}
