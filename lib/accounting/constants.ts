import {
  ACCOUNTING_ENTITIES,
  DEFAULT_ACCOUNTING_ENTITY_ID,
  type AccountingCollections,
} from "@/lib/accounting/entities";

/** @deprecated Prefer `getAccountingEntity(id).displayName` — default Notificas. */
export const ACCOUNTING_COMPANY_NAME = ACCOUNTING_ENTITIES[DEFAULT_ACCOUNTING_ENTITY_ID].displayName;

/** Colecciones de Notificas SRL (compat). Prefer `getAccountingEntity(id).collections`. */
export const ACCOUNTING_COLLECTIONS: AccountingCollections =
  ACCOUNTING_ENTITIES[DEFAULT_ACCOUNTING_ENTITY_ID].collections;

export {
  ACCOUNTING_ENTITIES,
  ACCOUNTING_ENTITY_IDS,
  ACCOUNTING_ENTITY_OPTIONS,
  DEFAULT_ACCOUNTING_ENTITY_ID,
  getAccountingEntity,
  isAccountingEntityId,
  parseAccountingEntityId,
  resolveAccountingEntity,
  type AccountingCollections,
  type AccountingEntity,
  type AccountingEntityId,
} from "@/lib/accounting/entities";
