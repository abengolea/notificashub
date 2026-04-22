/**
 * Normaliza número WhatsApp al formato usado en membresías (ej. 549...).
 */
export function normalizeHubPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length === 10 && !digits.startsWith("54")) {
    return "549" + digits;
  }
  return digits;
}
