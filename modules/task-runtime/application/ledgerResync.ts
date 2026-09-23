import type { TaskId } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import type { Clock, Logger } from '@crewstation/kernel';
import { systemClock } from '@crewstation/kernel';
import { RETENTION_EXPIRED } from '../domain/ledgerProjection';
import type { EnvironmentState, TaskEnvironment } from '../domain/taskEnvironment';
import { transition } from '../domain/taskEnvironment';
import type { EnvironmentLedger } from '../ports/ledger';
import type { RepositoryScope, UnitOfWork } from '../ports/unitOfWork';

const LIVE: EnvironmentState[] = ['creating', 'running', 'paused', 'releasing', 'failed'];
const PAGE = 200;

/**
 * 失败会话过了保留期（D9）：资源中心已把工作区记录改成「不要了」（retention-expired），调和器删它的 Pod、Secret、
 * 预览 Service 与路由，工作卷只进待回收（D8）。这里让环境跟上：记为已释放（不再能重试或恢复），不自己删集群对象、不删卷。
 * 失败时额度已经退还，这里不再退。
 */
async function followRetention(scope: RepositoryScope, env: TaskEnvironment, now: Date): Promise<boolean> {
  if (env.state !== 'failed' || env.native || !scope.ledger) return false;
  const record = await scope.ledger.workload(env);
  if (record?.desired !== 'absent' || record.releaseReason?.code !== RETENTION_EXPIRED) return false;
  const released = transition(transition(env, 'releasing', now, { connected: false }), 'released', now, { message: `released: ${RETENTION_EXPIRED}` });
  await scope.environments.update(released);
  await scope.events.publish(DomainTopic.taskReleased, { occurredAt: now.toISOString(), traceId: env.traceId, projectId: env.projectId, taskId: env.id, kind: env.kind, reason: 'failed' });
  return true;
}

/**
 * 台账补投影（RFC-025 第二期）：还在的环境、以及台账里还挂着的 task-runtime 记录，逐个在事务里锁住环境行再投影一次。
 * 部署时已存在的会话由它第一次写进台账；投影失败漏掉的（保存点回滚）由它追上；保留期满的失败会话由它记为已释放。
 * 锁行保证不会拿旧快照盖过并发更新的新状态。
 */
export async function resyncLedger(uow: UnitOfWork, ledger: EnvironmentLedger, logger: Logger, clock: Clock = systemClock): Promise<number> {
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
        if (await followRetention(scope, env, clock.now())) logger.info('failed environment retired after retention', { taskId: env.id });
        else await scope.ledger.sync(env);
        return 1;
      });
    } catch (error) {
      logger.warn('resource ledger resync failed', { taskId: id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return synced;
}
