import type { TaskId } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import type { Clock, Logger } from '@crewstation/kernel';
import { systemClock, precondition, jsonHash } from '@crewstation/kernel';
import { RETENTION_EXPIRED } from '../domain/ledgerProjection';
import type { EnvironmentState, TaskEnvironment } from '../domain/taskEnvironment';
import { transition } from '../domain/taskEnvironment';
import { DevelopmentParentRetentionTransitionSchema, developmentParentRetentionSpecHash } from '../domain/development/parentCompletion';
import { developmentParentTransitionHash, readDevelopmentParentEnding } from '../domain/development/parentEnding';
import { rebuildIsActive } from '../domain/environmentRebuild';
import { selectedDevelopmentParent } from './development/parent/request';
import { completedDevelopmentParent } from './development/parent/completed';
import { currentDevelopmentParentRebuild } from './development/parent/binding';
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
  if (await selectedDevelopmentParent(scope, env)) {
    const pointer = readDevelopmentParentEnding(env), endings = scope.parentEnding?.endings;
    if (!pointer || pointer.phase !== 'complete' || !endings?.recordRetentionTransition) throw precondition('原父保留期接续持久能力尚未恢复');
    const ending = await endings.get(pointer.endingId, true);
    if (!ending) throw precondition('原父完成来源尚未恢复');
    const source = await completedDevelopmentParent(scope, env, ending);
    const current = await currentDevelopmentParentRebuild(scope, env) ?? (env.rebuildId ? await scope.rebuilds.get(env.rebuildId) : undefined);
    if (env.rebuildId && !current || current && (rebuildIsActive(current) || !['failed', 'cancelled'].includes(current.state)))
      throw precondition('原父仍有恢复或未确认的请求，等待原请求结束');
    const specHash = developmentParentRetentionSpecHash(env, ending);
    if (source.witness.outcome !== 'compensation' || record.id !== env.id || record.kind !== 'dev-workspace'
      || record.projectId !== env.projectId || record.owner.module !== 'task-runtime' || record.owner.ref !== env.id
      || !Number.isSafeInteger(record.generation) || record.generation! < 1 || record.retainUntil !== undefined
      || !record.spec || typeof record.spec !== 'object' || Array.isArray(record.spec) || jsonHash(record.spec) !== specHash)
      throw precondition('原已受理保留期 Resource 来源不完整');
    const receipt = DevelopmentParentRetentionTransitionSchema.parse({ version: 1, endingId: ending.id, epochHash: ending.epochHash,
      sourceCompletionWitnessHash: jsonHash(source.witness), beforeTransitionHash: source.witness.afterTransitionHash,
      afterTransitionHash: developmentParentTransitionHash(released), runnerTokenHash: env.runnerTokenHash, retiredAt: now.toISOString(),
      resource: { id: record.id, projectId: record.projectId, ownerRef: record.owner.ref, kind: record.kind, generation: record.generation,
        specHash, retainUntil: null, releaseReason: RETENTION_EXPIRED } });
    if (!await endings.recordRetentionTransition(ending, receipt)) throw precondition('原父保留期接续发生竞争');
  }
  await scope.environments.update(released);
  await scope.events.publish(DomainTopic.taskReleased, { occurredAt: now.toISOString(), traceId: env.traceId, projectId: env.projectId, taskId: env.id, kind: env.kind, reason: 'failed' });
  return true;
}

/** Project before Task; raw presence is checked on the same Executor while the Task row stays locked. */
async function freshEnvironment(scope: RepositoryScope, id: TaskId): Promise<TaskEnvironment | undefined> {
  const original = await scope.environments.getById(id);
  if (!original) return undefined;
  if (original.kind === 'dev-session') await scope.admissions.lock(original.projectId);
  const current = await scope.environments.getForUpdate(id);
  if (!current) return undefined;
  if (current.projectId !== original.projectId || current.kind !== original.kind) throw precondition('台账补投影的原 Task 身份已变化');
  if (current.kind !== 'dev-session') return current;
  const view = await scope.environments.getMaintenanceView?.(id);
  if (view?.status !== 'present' || view.environment.id !== current.id || view.environment.projectId !== current.projectId
    || view.environment.kind !== current.kind) throw precondition('原开发 Task 存在非法或未确认的 SQL 材料');
  return view.environment;
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
        const env = await freshEnvironment(scope, id as TaskId);
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
