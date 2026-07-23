/**
 * Contabilidades independientes con la misma UI/API.
 * Cada entidad tiene sus propias colecciones Firestore y datos de emisor.
 */

export const ACCOUNTING_ENTITY_IDS = ["notificas_srl", "adrian_bengolea"] as const;
export type AccountingEntityId = (typeof ACCOUNTING_ENTITY_IDS)[number];

export const DEFAULT_ACCOUNTING_ENTITY_ID: AccountingEntityId = "notificas_srl";

export type AccountingCollections = {
  facturas: string;
  cobros: string;
  pagos: string;
  taxReminderSent: string;
  deducciones: string;
  bienes: string;
};

export type AccountingEntity = {
  id: AccountingEntityId;
  /** Valor del campo `empresa` en documentos */
  empresa: AccountingEntityId;
  /** Nombre corto en selector / títulos */
  label: string;
  /** Razón social / nombre fiscal */
  displayName: string;
  cuit: string;
  collections: AccountingCollections;
  /** Prefijo Storage para PDFs */
  storagePrefix: string;
  /**
   * Persona humana (no sociedad): no presenta balances, pero sí DDJJ de
   * Ganancias personas humanas y Bienes Personales. Gatea la UI de
   * Deducciones personales y la pestaña Bienes Personales.
   */
  isIndividual: boolean;
  /**
   * Integraciones atadas a credenciales de Notificas (AFIP WSFE, MP, extracto bancario).
   * Mis Comprobantes / PDF / CRUD / exportaciones funcionan en todas.
   */
  integrations: {
    afipSyncVentas: boolean;
    mercadoPago: boolean;
    bankIngest: boolean;
  };
};

function collectionsFor(slug: string): AccountingCollections {
  return {
    facturas: `accounting_${slug}_facturas`,
    cobros: `accounting_${slug}_cobros`,
    pagos: `accounting_${slug}_pagos`,
    taxReminderSent: `accounting_${slug}_tax_reminder_sent`,
    deducciones: `accounting_${slug}_deducciones`,
    bienes: `accounting_${slug}_bienes`,
  };
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

function bengoleaCuitFromEnv(): string {
  const raw = process.env.ACCOUNTING_BENGOLEA_CUIT?.trim() ?? "";
  return digitsOnly(raw);
}

export const ACCOUNTING_ENTITIES: Record<AccountingEntityId, AccountingEntity> = {
  notificas_srl: {
    id: "notificas_srl",
    empresa: "notificas_srl",
    label: "Notificas SRL",
    displayName: "Notificas SRL",
    cuit: "33717298689",
    collections: collectionsFor("notificas_srl"),
    storagePrefix: "accounting-notificas-srl",
    isIndividual: false,
    integrations: {
      afipSyncVentas: true,
      mercadoPago: true,
      bankIngest: true,
    },
  },
  adrian_bengolea: {
    id: "adrian_bengolea",
    empresa: "adrian_bengolea",
    label: "Adrián Bengolea",
    displayName: "Adrián Bengolea",
    cuit: bengoleaCuitFromEnv(),
    collections: collectionsFor("adrian_bengolea"),
    storagePrefix: "accounting-adrian-bengolea",
    isIndividual: true,
    integrations: {
      afipSyncVentas: false,
      mercadoPago: false,
      bankIngest: false,
    },
  },
};

export const ACCOUNTING_ENTITY_OPTIONS: ReadonlyArray<{
  id: AccountingEntityId;
  label: string;
}> = ACCOUNTING_ENTITY_IDS.map((id) => ({
  id,
  label: ACCOUNTING_ENTITIES[id].label,
}));

export function isAccountingEntityId(value: unknown): value is AccountingEntityId {
  return typeof value === "string" && (ACCOUNTING_ENTITY_IDS as readonly string[]).includes(value);
}

export function getAccountingEntity(id: AccountingEntityId | string | null | undefined): AccountingEntity {
  if (isAccountingEntityId(id)) return ACCOUNTING_ENTITIES[id];
  return ACCOUNTING_ENTITIES[DEFAULT_ACCOUNTING_ENTITY_ID];
}

/** Lee `entity` de query string; default Notificas. */
export function parseAccountingEntityId(
  searchParams: URLSearchParams,
  bodyEntity?: unknown
): AccountingEntityId {
  const fromQuery = searchParams.get("entity");
  if (isAccountingEntityId(fromQuery)) return fromQuery;
  if (isAccountingEntityId(bodyEntity)) return bodyEntity;
  return DEFAULT_ACCOUNTING_ENTITY_ID;
}

export function resolveAccountingEntity(
  searchParams: URLSearchParams,
  bodyEntity?: unknown
): AccountingEntity {
  return getAccountingEntity(parseAccountingEntityId(searchParams, bodyEntity));
}
