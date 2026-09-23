import { drizzleMaintenance } from './drizzleMaintenance';
import { publishDomainEvent } from '@crewstation/eventbus';
import type { Database, Executor } from '@crewstation/persistence';
import type { RepositoryScope, UnitOfWork } from '../../ports/unitOfWork';
import { drizzleOfflinePolicyRepository, drizzleReleaseRepository, drizzleSlotEventRepository, drizzleSlotRepository, drizzleTrafficSwitchRepository } from './drizzleRepositories';
import type { SlotProjectionDeps } from './ledgerProjection';
import { findSlotRecord, ledgerSlotRepository, syncSlotLedger } from './ledgerProjection';

/** 可选的资源台账投影（RFC-025 第三期）：给了就在每次槽保存的同一事务里同步台账。 */
export function scopeOver(executor: Executor, lockSlots = false, projection?: SlotProjectionDeps): RepositoryScope {
  const releases = drizzleReleaseRepository(executor), slots = drizzleSlotRepository(executor, lockSlots), offlinePolicy = drizzleOfflinePolicyRepository(executor);
  const sources = { releases, offlinePolicy };
  return {
    maintenance: drizzleMaintenance(executor),
    releases,
    slots: projection ? ledgerSlotRepository(slots, (value) => syncSlotLedger(executor, projection, sources, value)) : slots,
    ...(projection ? { ledger: {
      sync: (value: Parameters<typeof syncSlotLedger>[3]) => syncSlotLedger(executor, projection, sources, value),
      slot: (serviceId: Parameters<typeof findSlotRecord>[2], physical: Parameters<typeof findSlotRecord>[3]) => findSlotRecord(executor, projection, serviceId, physical),
    } } : {}),
    switches: drizzleTrafficSwitchRepository(executor),
    slotEvents: drizzleSlotEventRepository(executor),
    offlinePolicy,
    events: { publish: async (topic, payload) => { await publishDomainEvent(executor, topic, payload); } },
  };
}

export function drizzleUnitOfWork(db: Database, projection?: SlotProjectionDeps): UnitOfWork {
  return { read: scopeOver(db, false, projection), run: (fn) => db.transaction((tx) => fn(scopeOver(tx, true, projection))) };
}
