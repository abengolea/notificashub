/**
 * Ejecuta chequeo Libro de IVA Digital (orientativo) y envía un digest por correo.
 * Dedupe en Firestore: no re-envía mismo período+fecha dentro de cooldown (días).
 */
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { ACCOUNTING_COMPANY_NAME, ACCOUNTING_COLLECTIONS } from "@/lib/accounting/constants";
import { ultimoDigitoCuitCuil, vencimientosLibroParaPanel, type VencimientoPanelItem } from "@/lib/arca-export/vencimientos";
import { escapeHtml, sendTaxReminderEmail } from "@/lib/tax-reminders/mailer";

function parseIntEnv(name: string, def: number): number {
  const v = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) ? v : def;
}

function cooldownMs(days: number): number {
  return days * 86400000;
}

function docIdFor(row: VencimientoPanelItem): string {
  return `libro_iva_${row.periodo.key}_${row.fechaReferenciaOrientativaISO.replace(/-/g, "")}`;
}

function itemInWindow(row: VencimientoPanelItem, diasAntesMax: number, diasAtrasMin: number): boolean {
  const d = row.diasHastaOrientativo;
  if (typeof d !== "number") return false;
  return d <= diasAntesMax && d >= diasAtrasMin;
}

async function wasRecentlySent(docId: string, cooldownDays: number): Promise<boolean> {
  const snap = await db.collection(ACCOUNTING_COLLECTIONS.taxReminderSent).doc(docId).get();
  if (!snap.exists) return false;
  const data = snap.data();
  const sentAt = data?.sentAt as Timestamp | undefined;
  if (!sentAt?.toDate) return false;
  const elapsed = Date.now() - sentAt.toDate().getTime();
  return elapsed < cooldownMs(cooldownDays);
}

async function markSent(docId: string): Promise<void> {
  await db.collection(ACCOUNTING_COLLECTIONS.taxReminderSent).doc(docId).set(
    {
      sentAt: FieldValue.serverTimestamp(),
      tipo: "libro_iva_digital_orientativo",
    },
    { merge: true }
  );
}

function buildDigestHtml(rows: VencimientoPanelItem[], baseUrlHint: string | null): string {
  const empresa = escapeHtml(ACCOUNTING_COMPANY_NAME);
  let table = `
    <p><strong>${empresa}</strong> — recordatorio orientativo de <strong>Libro de IVA Digital</strong> (según calendario cargado en NotificasHub).</p>
    <p style="font-size:13px;color:#555">No reemplaza el calendario oficial ARCA ni el criterio de tu contador. Verificá en <a href="https://www.afip.gob.ar/vencimientos/">afip.gob.ar/vencimientos</a>.</p>
    <table cellpadding="8" cellspacing="0" border="1" style="border-collapse:collapse;font-size:14px;margin-top:12px;">
    <thead><tr><th>Período fiscal</th><th>Fecha ref. grupos / Todas</th><th>Días (−=vencido)</th></tr></thead><tbody>`;
  for (const r of rows) {
    table += `<tr><td>${r.periodo.month}/${r.periodo.year}</td><td>${escapeHtml(r.fechaReferenciaOrientativaISO)} / g ${escapeHtml(r.grupoCuilISO)} · todas ${escapeHtml(r.todasISO)}</td><td>${r.diasHastaOrientativo ?? "—"}</td></tr>`;
  }
  table += `</tbody></table>`;
  if (baseUrlHint) {
    const u = escapeHtml(baseUrlHint);
    table += `<p style="margin-top:16px"><a href="${u}/admin/contabilidad">Abrir contabilidad en NotificasHub</a></p>`;
  }
  return table;
}

export type ProcessTaxRemindersResult = {
  configured: boolean;
  ultimoDigitoUsado: number | null;
  candidatos: number;
  enviadosEnMail: number;
  email: { ok: true; provider: string } | { ok: false; reason: string };
  skipReason?: string;
};

export async function processTaxReminders(): Promise<ProcessTaxRemindersResult> {
  const to = process.env.TAX_REMINDER_TO?.trim();
  if (!to) {
    return {
      configured: false,
      ultimoDigitoUsado: null,
      candidatos: 0,
      enviadosEnMail: 0,
      email: { ok: false, reason: "TAX_REMINDER_TO no definido" },
      skipReason: "Definí TAX_REMINDER_TO (ej. abengolea1@gmail.com) en .env",
    };
  }

  const cuit = process.env.TAX_REMINDER_CUIT?.trim();
  const digitEnv = process.env.TAX_REMINDER_CUIT_DIGIT?.trim();

  let ultimoDigito: number | null = null;
  if (cuit) {
    ultimoDigito = ultimoDigitoCuitCuil(cuit);
  } else if (digitEnv && /^[0-9]$/.test(digitEnv)) {
    ultimoDigito = parseInt(digitEnv, 10);
  }

  if (ultimoDigito == null || !Number.isFinite(ultimoDigito)) {
    return {
      configured: false,
      ultimoDigitoUsado: null,
      candidatos: 0,
      enviadosEnMail: 0,
      email: { ok: false, reason: "Falta CUIT o dígito" },
      skipReason: "Definí TAX_REMINDER_CUIT o TAX_REMINDER_CUIT_DIGIT (un solo dígito 0–9)",
    };
  }

  const monthsBack = Math.min(72, Math.max(3, parseIntEnv("TAX_REMINDER_MONTHS_BACK", 18)));
  const diasAntes = parseIntEnv("TAX_REMINDER_DIAS_ANTES", 21);
  const diasAtrasAbs = parseIntEnv("TAX_REMINDER_DIAS_ATRAS_MAX_ABSOLUTO", 120);
  const diasAtrasMin = -Math.abs(diasAtrasAbs);
  const cooldownDays = Math.min(90, Math.max(1, parseIntEnv("TAX_REMINDER_COOLDOWN_DAYS", 7)));

  const todos = vencimientosLibroParaPanel(ultimoDigito, monthsBack).filter((r) =>
    itemInWindow(r, diasAntes, diasAtrasMin)
  );

  const pending: VencimientoPanelItem[] = [];
  for (const row of todos) {
    const id = docIdFor(row);
    if (await wasRecentlySent(id, cooldownDays)) continue;
    pending.push(row);
  }

  if (pending.length === 0) {
    return {
      configured: true,
      ultimoDigitoUsado: ultimoDigito,
      candidatos: todos.length,
      enviadosEnMail: 0,
      email: { ok: true, provider: "none" },
      skipReason:
        todos.length === 0
          ? "Ningún período en la ventana de días configurada"
          : "Todos los períodos pertinentes están en cooldown desde el último mail",
    };
  }

  const baseHint =
    process.env.APP_PUBLIC_BASE_URL?.replace(/\/$/, "") ??
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    null;

  const html = buildDigestHtml(pending, baseHint);
  const subject = `[${ACCOUNTING_COMPANY_NAME}] Vencimiento Libro IVA — ${pending.length} período(s)`;

  const mail = await sendTaxReminderEmail(subject, html);

  if (!mail.ok) {
    return {
      configured: true,
      ultimoDigitoUsado: ultimoDigito,
      candidatos: todos.length,
      enviadosEnMail: 0,
      email: mail,
    };
  }

  for (const row of pending) {
    await markSent(docIdFor(row));
  }

  return {
    configured: true,
    ultimoDigitoUsado: ultimoDigito,
    candidatos: todos.length,
    enviadosEnMail: pending.length,
    email: mail,
  };
}
