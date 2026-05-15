/** Empresa objetivo para DDJJ orientativas (IVA / Ganancias). */
export const ACCOUNTING_COMPANY_NAME = "Notificas SRL";

export const ACCOUNTING_COLLECTIONS = {
  facturas: "accounting_notificas_srl_facturas",
  cobros: "accounting_notificas_srl_cobros",
  pagos: "accounting_notificas_srl_pagos",
  /** Log de mails de recordatorio vencimientos (anti-spam por período) */
  taxReminderSent: "accounting_notificas_srl_tax_reminder_sent",
} as const;
