/**
 * Envío transactional: Resend (REST) si hay RESEND_API_KEY; si no, SMTP via nodemailer.
 */
export type SendEmailResult =
  | { ok: true; provider: "resend" | "smtp" }
  | { ok: false; reason: string };

/** HTML plano sanitizado antes de usar en plantilla si hace falta */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function sendTaxReminderEmail(subject: string, html: string): Promise<SendEmailResult> {
  const to = process.env.TAX_REMINDER_TO?.trim();
  if (!to) {
    return { ok: false, reason: "Falta TAX_REMINDER_TO en el entorno" };
  }

  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (resendKey) {
    const from = process.env.RESEND_FROM?.trim() ?? process.env.BILLING_EMAIL_FROM?.trim();
    if (!from) {
      return { ok: false, reason: "Con RESEND_API_KEY hace falta RESEND_FROM o BILLING_EMAIL_FROM verificado en Resend" };
    }

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
      }),
    });

    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      return { ok: false, reason: `Resend HTTP ${r.status}: ${errText.slice(0, 400)}` };
    }

    return { ok: true, provider: "resend" };
  }

  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const port = Number(process.env.SMTP_PORT ?? "465");
  const secure = process.env.SMTP_SECURE !== "false";
  const from = process.env.SMTP_FROM?.trim();

  if (!host || !user || !pass || !from) {
    return {
      ok: false,
      reason:
        "Sin configuración de mail: poné RESEND_API_KEY (y RESEND_FROM) o SMTP_HOST/SMTP_USER/SMTP_PASS/SMTP_FROM",
    };
  }

  try {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host,
      port: Number.isFinite(port) ? port : 465,
      secure,
      auth: { user, pass },
    });

    await transporter.sendMail({ from, to, subject, html });
    return { ok: true, provider: "smtp" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: msg };
  }
}
