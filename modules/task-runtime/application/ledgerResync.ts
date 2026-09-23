import type { TaskId } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import type { EnvironmentState } from '../domain/taskEnvironment';
import type { EnvironmentLedger } from '../ports/ledger';
import type { UnitOfWork } from '../ports/unitOfWork';

const LIVE: EnvironmentState[] = ['creating', 'running', 'paused', 'releasing', 'failed'];
const PAGE = 200;

/**
 * 台账补投影（RFC-025 第二期）：还在的环境、以及台账里还挂着的 task-runtime 记录，逐个在事务里锁住环境行再投影一次。
 * 部署时已存在的会话由它第一次写进台账；投影失败漏掉的（保存点回滚）由它追上。锁行保证不会拿旧快照盖过并发更新的新状态。
 */
export async function resyncLedger(uow: UnitOfWork, ledger: EnvironmentLedger, logger: Logger): Promise<number> {
  const ids = new Set<string>();
  for (let after: string | undefined; ;) {
    const page = await uow.read.environments.listByStates(LIVE, { ...(after ? { after } : {}), limit: PAGE });
    for (const env of page) ids.add(env.id);
    if (page.length < PAGE) break;
    after = page.at(-1)!.id;
  }
  for (const record of await ledger.live()) ids.add(record.owner.ref.split('/')[0]!);
  let synced = 0;
  for (const id of ids) {
    try {
      synced += await uow.run(async (scope) => {
        const env = await scope.environments.getForUpdate(id as TaskId);
        if (!env || !scope.ledger) return 0;
        await scope.ledger.sync(env);
        return 1;
      });
    } catch (error) {
      logger.warn('resource ledger resync failed', { taskId: id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return synced;
}
