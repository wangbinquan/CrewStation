import type { ReleaseId, ServiceId } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { projectSlots } from '../../domain/ledgerProjection';
import type { PhysicalSlot, ServiceSlots } from '../../domain/slots';
import type { SlotLedger, SlotRecordRef } from '../../ports/ledger';
import type { ServiceResolver } from '../../ports/platform';
import type { ReleaseRepository, SlotRepository } from '../../ports/repositories';

export interface SlotProjectionDeps {
  readonly ledger: SlotLedger;
  readonly services: ServiceResolver;
  readonly logger: Logger;
}

/**
 * 在当前事务里把一个服务的两个槽投影进资源台账（RFC-025 第三期）。包在保存点里：台账写失败只回滚保存点、记一条告警，
 * 槽的状态照常提交——迁移期间台账的问题不能挡住发布、切流与下线；漏掉的由补投影追上。
 */
export async function syncSlotLedger(executor: Executor, deps: SlotProjectionDeps, releases: ReleaseRepository, slots: ServiceSlots): Promise<void> {
  try {
    const service = await deps.services.resolveServiceById(slots.serviceId);
    if (!service) return;
    const tags = new Map<string, string>();
    for (const releaseId of [slots.blue, slots.green].map((slot) => slot.releaseId ?? slot.offline?.releaseId).filter((id): id is ReleaseId => !!id)) {
      const release = await releases.getById(releaseId);
      if (release) tags.set(releaseId, release.tag);
    }
    await executor.transaction(async (savepoint) => {
      const writer = deps.ledger.within(savepoint);
      for (const slot of projectSlots(slots, service, (id) => tags.get(id))) {
        await writer.declare({ kind: 'service-slot', ref: slot.ref, projectId: slot.projectId, spec: { children: slot.children }, display: slot.display, conditions: slot.conditions });
      }
    });
  } catch (error) {
    deps.logger.warn('resource ledger slot projection failed', { serviceId: slots.serviceId, error: error instanceof Error ? error.message : String(error) });
  }
}

/** 读一个物理槽的台账记录：包在保存点里，台账读不到当作没有，不让调用方的事务因此中止。 */
export async function findSlotRecord(executor: Executor, deps: SlotProjectionDeps, serviceId: ServiceId, physical: PhysicalSlot): Promise<SlotRecordRef | undefined> {
  try { return await executor.transaction((savepoint) => deps.ledger.within(savepoint).find(`${serviceId}/${physical}`, 'service-slot')); } catch { return undefined; }
}

/** 槽仓储的投影装饰：每次保存之后，在同一事务里同步台账。 */
export function ledgerSlotRepository(inner: SlotRepository, sync: (slots: ServiceSlots) => Promise<void>): SlotRepository {
  return {
    ...inner,
    initialize: async (slots) => { await inner.initialize(slots); await sync(slots); },
    save: async (slots) => { await inner.save(slots); await sync(slots); },
  };
}
