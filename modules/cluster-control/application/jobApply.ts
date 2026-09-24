import type { Logger } from '@crewstation/kernel';
import type { JobRender } from '../domain/jobRender';
import { jobRenderOf } from '../domain/jobRender';
import type { ClusterWriter, Ensured, ManagedObjectFeed } from '../ports/cluster';
import type { JobOwners, LedgerObservations, LedgerRecordView } from '../ports/ledger';
import type { ObservationStats } from './observeChange';

export interface JobApplyDeps {
  readonly ledger: LedgerObservations;
  readonly feed: ManagedObjectFeed;
  readonly cluster: ClusterWriter;
  readonly stats: ObservationStats;
  readonly logger: Logger;
  /** 构建、迁移 Job 的所属模块（release）：建凭据 Secret 时要内容；不给就不建 Job。 */
  readonly jobs?: JobOwners;
}

const isTrue = (record: LedgerRecordView, type: string): boolean => record.conditions.some((entry) => entry.type === type && entry.status === 'true');

function counted(deps: JobApplyDeps, record: LedgerRecordView, kind: string, job: JobRender, name: string, outcome: Ensured): void {
  if (!outcome.created) return;
  deps.stats.applied += 1;
  deps.logger.info('resource child applied', { resourceId: record.id, kind, namespace: job.namespace, name, reason: 'missing' });
}

/** 结束了（成功、失败，或流水线已放弃）：凭据 Secret 不留；Job 与它的 Pod 交给 TTL，构建日志在那之前照常可读。 */
async function dropSecret(deps: JobApplyDeps, record: LedgerRecordView, job: JobRender): Promise<void> {
  const cached = deps.feed.cached('Secret', job.namespace, job.secret), uid = cached?.metadata.uid;
  if (!uid || cached.metadata.deletionTimestamp) return;
  await deps.cluster.remove({ kind: 'Secret', namespace: job.namespace, name: job.secret, uid });
  deps.stats.removed += 1;
  deps.logger.info('resource child removed', { resourceId: record.id, kind: 'Secret', namespace: job.namespace, name: job.secret, reason: 'job-ended' });
}

/**
 * 构建、迁移 Job（RFC-025 T8）：release 写期望，调和器建出。先建这一次的凭据 Secret（不可变，内容此刻向 release 要，值不落台账），再建 Job
 * （只从 Secret 引用凭据）。Job 建过就不再建——观测到它就补记「已建」，之后被 TTL 或人删掉也不补建（结果由 Finished 留在台账里）；
 * 结束了（Finished）或流水线已放弃（Failed）就删掉凭据 Secret。建不成的写进记录（Created 为假，流水线据此判发布失败），抛出后按退避重试。
 * 旧形状（期望里没有 job，release 自己建的）不碰。
 */
export async function applyJob(deps: JobApplyDeps, record: LedgerRecordView): Promise<void> {
  if (record.spec['job'] === undefined) return;
  const job = jobRenderOf(record.spec);
  if (!job) {
    deps.logger.warn('resource job spec incomplete', { resourceId: record.id });
    return;
  }
  if (isTrue(record, 'Finished') || isTrue(record, 'Failed')) return dropSecret(deps, record, job);
  if (deps.feed.cached('Job', job.namespace, job.name)) {
    await deps.ledger.observeConditions(record.id, [{ type: 'Created', status: 'true' }]);
    return;
  }
  if (isTrue(record, 'Created') || !deps.jobs) return;
  const owners = deps.jobs;
  try {
    counted(deps, record, 'Secret', job, job.secret, await deps.cluster.ensureJobSecret(job, () => owners.jobEnvValues({ recordId: record.id, releaseId: job.releaseId, purpose: job.purpose })));
    counted(deps, record, 'Job', job, job.name, await deps.cluster.ensureJob(job));
    await deps.ledger.observeConditions(record.id, [{ type: 'Created', status: 'true' }]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.ledger.observeConditions(record.id, [{ type: 'Created', status: 'false', reason: 'create-failed', message: `${job.purpose === 'build' ? '构建' : '迁移'} Job 没有建成：${message}`.slice(0, 2000) }]).catch(() => undefined);
    throw error;
  }
}
