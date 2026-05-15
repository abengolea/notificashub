import { Timestamp } from "firebase-admin/firestore";

export function toIso(val: Timestamp | Date | unknown): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  const t = val as { toDate?: () => Date };
  return t.toDate?.()?.toISOString() ?? null;
}

export function fechaFieldToUi(isoOrNull: string | null): string {
  if (!isoOrNull?.trim()) return "";
  const d = new Date(isoOrNull);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
