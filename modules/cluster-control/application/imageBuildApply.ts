import { imageBuildRenderOf } from '../domain/imageBuildRender';
import type { LedgerRecordView } from '../ports/ledger';
import type { Logger } from '@crewstation/kernel';
import type { ClusterWriter, ManagedObjectFeed } from '../ports/cluster';
import type { JobOwners, LedgerObservations } from '../ports/ledger';
import type { ObservationStats } from './observeChange';

interface ImageBuildApplyDeps {
  readonly signal?: AbortSignal;
  readonly ledger: LedgerObservations; readonly feed: ManagedObjectFeed; readonly cluster: ClusterWriter;
  readonly stats: ObservationStats; readonly logger: Logger; readonly jobs?: JobOwners;
}

/** 只声明一次；控制面持久结果并请求释放后，通用 UID 回收器再删 Job、两个容器的 Pod 和 Secret。 */
export async function applyImageBuild(deps: ImageBuildApplyDeps, record: LedgerRecordView): Promise<void> {
  const plan = imageBuildRenderOf(record.spec);
  if (!plan || record.owner?.module !== 'runtime-environment' || plan.resourceId !== record.id || plan.projectId !== record.projectId) {
    deps.logger.warn('runtime image build spec incomplete or owner mismatch', { resourceId: record.id }); return;
  }
  const { ensureImageBuildJob, ensureImageBuildSecret } = deps.cluster, values = deps.jobs?.imageBuildSecretValues;
  if (!ensureImageBuildJob || !ensureImageBuildSecret || !values) return;
  if (record.conditions.some((c) => ['Created', 'Finished', 'Failed'].includes(c.type) && c.status === 'true')) return;
  if (deps.feed.cached('Job', plan.namespace, plan.name)) { await deps.ledger.observeConditions(record.id, [{ type: 'Created', status: 'true' }]); return; }
  // 不在 Job 完成时提前删除 Secret：控制器仍需读取原 Secret 做日志掩码与凭据撤销。
  const signal = deps.signal ? AbortSignal.any([deps.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000);
  for (const operation of [() => ensureImageBuildSecret(plan, () => values({ recordId: record.id, buildId: plan.buildId, executionEpoch: plan.executionEpoch }), signal), () => ensureImageBuildJob(plan, signal)]) {
    deps.signal?.throwIfAborted();
    if ((await deps.ledger.get(record.id))?.desired !== 'present') return;
    if ((await operation()).created) deps.stats.applied++;
  }
  await deps.ledger.observeConditions(record.id, [{ type: 'Created', status: 'true' }]);
}
