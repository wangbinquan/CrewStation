import type { LedgerRecord } from './record';

/** A protected task volume cannot inherit a Pod's release or the administrator's generic delete action. */
export function protectedTaskVolume(record: Pick<LedgerRecord, 'kind'> & { readonly spec?: LedgerRecord['spec'] }): boolean {
  return record.kind === 'volume' && record.spec?.['taskStorage'] !== undefined;
}
