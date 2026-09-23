import type { Logger } from '@crewstation/kernel';
import type { UnitOfWork } from '../ports/unitOfWork';

/**
 * 服务槽的台账补投影（RFC-025 第三期）：逐个服务在事务里锁住槽行再投影一次。部署时已有的槽由它第一次写进台账；
 * 投影失败漏掉的（保存点回滚）由它追上。锁行保证不会拿旧快照盖过并发保存的新状态。
 */
export async function resyncSlotLedger(uow: UnitOfWork, logger: Logger): Promise<number> {
  let synced = 0;
  for (const listed of await uow.read.slots.list()) {
    try {
      synced += await uow.run(async (scope) => {
        const slots = await scope.slots.get(listed.serviceId);
        if (!slots || !scope.ledger) return 0;
        await scope.ledger.sync(slots);
        return 1;
      });
    } catch (error) {
      logger.warn('resource ledger slot resync failed', { serviceId: listed.serviceId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return synced;
}
