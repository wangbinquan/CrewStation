import { jsonHash, isPlatformError, precondition } from '@crewstation/kernel';
import { DevelopmentParentRebuildBindingSchema } from '../../../domain/development/parentRebuildBinding';
import { completeStage } from '../../../domain/podStartup';
import { hashRunnerToken, newRunnerToken } from '../../../domain/runnerToken';
import type { TaskEnvironment } from '../../../domain/taskEnvironment';
import type { EnvironmentRebuild } from '../../../domain/environmentRebuild';
import type { DevelopmentParentEndingJobLease } from '../../../ports/developmentParentEndingScope';
import type { RepositoryScope } from '../../../ports/unitOfWork';
import { containerEnv } from '../../containerEnv';
import { previewRouteOf } from '../../createEnvironment';
import { beginReplace, requireRebuildLease, rebuildFailureMessage } from '../../rebuildExecution';
import type { RebuildExecutionDeps, RebuildHeartbeat } from '../../rebuildExecution';
import { retainedVolume } from '../../rebuildInspection';
import { requirePublishedParentRebuild } from '../../../domain/development/parentRebuildPublication';
import { admitDevelopmentParentEnding, prepareDevelopmentParentEnding } from './request';
import { withDevelopmentRebuild } from './rebuildPublication';

async function selectedCommit<T>(deps: RebuildExecutionDeps, original: EnvironmentRebuild, heartbeat: RebuildHeartbeat, identity: DevelopmentParentEndingJobLease | undefined,
  operation: (scope: RepositoryScope, record: EnvironmentRebuild, environment: TaskEnvironment) => Promise<T>): Promise<T> {
  await requireRebuildLease(heartbeat);
  const run = async (scope: RepositoryScope, record: EnvironmentRebuild) => {
    const binding = DevelopmentParentRebuildBindingSchema.parse(record.developmentParentBinding), ending = await scope.parentEnding?.endings.get(binding.endingId);
    const environment = await scope.environments.getForUpdate(record.taskId);
    if (!environment || !ending || record.taskId !== original.taskId) throw precondition('原选中恢复身份尚未恢复');
    requirePublishedParentRebuild(environment, record, ending);
    if (binding.kind === 'completed-ending') {
      const claim = await scope.parentEnding!.claims.get(ending.id, true);
      if (!claim || claim.state !== 'published' || claim.currentRebuildId !== record.id || claim.revision !== binding.claimRevision) throw precondition('原选中恢复发布占位已变化');
    }
    return operation(scope, record, environment);
  };
  if (identity) return withDevelopmentRebuild(deps, original, identity, run);
  return deps.uow.run(async (scope) => {
    await scope.admissions.lock(original.projectId);
    const record = await scope.rebuilds.get(original.id);
    if (!record || jsonHash(record.developmentParentBinding) !== jsonHash(original.developmentParentBinding)) throw precondition('原 ledger 恢复绑定已变化');
    return run(scope, record);
  });
}
async function compensate(deps: RebuildExecutionDeps, record: EnvironmentRebuild, heartbeat: RebuildHeartbeat, identity?: DevelopmentParentEndingJobLease) {
  const environment = await deps.uow.read.environments.getById(record.taskId);
  if (!environment) throw precondition('原恢复父 Task 尚未恢复');
  const prepared = await prepareDevelopmentParentEnding(deps, environment);
  if (!prepared) throw precondition('原恢复新 epoch 退出选择尚未恢复');
  await selectedCommit(deps, record, heartbeat, identity, async (scope, current, parent) => {
    if (!['queued', 'replacing', 'starting'].includes(current.state) || parent.state !== 'creating') return;
    await admitDevelopmentParentEnding(scope, prepared, 'compensation', { cause: 'rebuild-failed', rebuildId: current.id,
      message: current.failureReason ?? '恢复失败，等待本次容器独立退出；原工作卷保留' }, deps.clock.now());
  });
}
function requireProvisioning(record: EnvironmentRebuild, environment: TaskEnvironment): void {
  if (environment.state !== 'creating' || !['queued', 'replacing'].includes(record.state))
    throw precondition('恢复已被原新 epoch 接续，迟到准备不再写入', { code: 'development_rebuild_advanced' });
}
async function provision(deps: RebuildExecutionDeps, record: EnvironmentRebuild, heartbeat: RebuildHeartbeat, identity?: DevelopmentParentEndingJobLease) {
  let environment = await selectedCommit(deps, record, heartbeat, identity, async (scope, current, parent) => {
    requireProvisioning(current, parent);
    if (current.state === 'queued') await beginReplace(deps, scope, current);
    return parent;
  });
  if (environment.state !== 'creating' || !['queued', 'replacing'].includes(record.state)) return;
  await requireRebuildLease(heartbeat);
  if (retainedVolume(await deps.recoveryCluster.inspect(environment)).uid !== record.input.expectedVolumeUid) throw precondition('原保留工作卷已变化');
  const service = await deps.services.resolveServiceById(environment.serviceId);
  if (!service) throw precondition('原恢复所属服务已不存在');
  await selectedCommit(deps, record, heartbeat, identity, async () => {});
  const secret = await deps.provisioner.prepareSecret(record, () => containerEnv(deps, environment, service, newRunnerToken()));
  environment = await selectedCommit(deps, record, heartbeat, identity, async (scope, current, parent) => {
    requireProvisioning(current, parent);
    if (current.secretUid && current.secretUid !== secret.uid) throw precondition('原恢复 Secret 实例已变化');
    const prepared = { ...parent, runnerTokenHash: hashRunnerToken(secret.token) };
    await scope.rebuilds.update({ ...current, secretUid: secret.uid, updatedAt: deps.clock.now() });
    await scope.environments.update(prepared); return prepared;
  });
  const spec = { env: environment, image: record.image, envVars: {}, envSecretName: record.secretName, resources: record.input.profile,
    ...(record.nodeName ? { nodeName: record.nodeName } : {}), ...(record.creation === 'ledger' ? {} : previewRouteOf(deps.settings, environment, service.slug)) };
  await selectedCommit(deps, record, heartbeat, identity, async () => {});
  if (retainedVolume(await deps.recoveryCluster.inspect(environment)).uid !== record.input.expectedVolumeUid) throw precondition('原工作卷在准备期间已变化');
  const podUid = await deps.provisioner.ensurePod({ ...record, secretUid: secret.uid }, spec);
  await selectedCommit(deps, record, heartbeat, identity, async (scope, current, parent) => {
    requireProvisioning(current, parent);
    if (current.podUid && current.podUid !== podUid) throw precondition('原恢复 Pod 实例已变化');
    await scope.rebuilds.update({ ...current, podUid, secretUid: secret.uid, updatedAt: deps.clock.now() });
    await scope.environments.update({ ...parent, podUid });
  });
  await selectedCommit(deps, record, heartbeat, identity, async () => {});
  if (retainedVolume(await deps.recoveryCluster.inspect(environment)).uid !== record.input.expectedVolumeUid) throw precondition('原工作卷在创建期间已变化');
  await deps.provisioner.ensurePreview({ ...record, podUid, secretUid: secret.uid }, spec);
  await selectedCommit(deps, record, heartbeat, identity, async (scope, current, parent) => {
    requireProvisioning(current, parent);
    const now = deps.clock.now();
    await scope.environments.update({ ...parent, updatedAt: now, message: '恢复容器已创建，等待新环境连接',
      ...(parent.startup ? { startup: completeStage(parent.startup, 'replace', now.toISOString()) } : {}) });
    await scope.rebuilds.update({ ...current, state: 'starting', message: '等待新环境连接，原 CLI 不会自动启动', updatedAt: now });
  });
}
/** Every physical/read/credential/heartbeat call is outside Project. SQL segments revalidate the original new epoch. */
export async function executeDevelopmentParentRebuild(deps: RebuildExecutionDeps, id: string, heartbeat: RebuildHeartbeat, identity?: DevelopmentParentEndingJobLease): Promise<void> {
  const record = await deps.uow.read.rebuilds.get(id);
  if (!record || !Object.hasOwn(record, 'developmentParentBinding')) throw precondition('原恢复选择缺少严格绑定');
  try { if (record.failureReason) await compensate(deps, record, heartbeat, identity); else await provision(deps, record, heartbeat, identity); }
  catch (error) {
    if (isPlatformError(error) && error.details?.['code'] === 'development_parent_job_lease_lost') throw error;
    if (isPlatformError(error) && error.details?.['code'] === 'development_rebuild_advanced') return;
    const parent = await deps.uow.read.environments.getById(record.taskId);
    if (parent && Object.hasOwn(parent, 'parentEnding')) return;
    await selectedCommit(deps, record, heartbeat, identity, async (scope, current) => {
      if (!['queued', 'replacing'].includes(current.state)) return;
      const attempts = (current.attempts ?? 0) + 1, terminal = isPlatformError(error) && error.kind === 'precondition' || attempts >= 5;
      await scope.rebuilds.update({ ...current, attempts, updatedAt: deps.clock.now(), message: rebuildFailureMessage(error),
        ...(terminal ? { failureReason: current.failureReason ?? rebuildFailureMessage(error) } : {}) });
    });
    // A real prepared new Pod requires its own compensation ending. Missing/unbound physical material remains pending.
    const fresh = await deps.uow.read.rebuilds.get(id);
    if (fresh?.failureReason) await compensate(deps, fresh, heartbeat, identity);
    else throw new Error('恢复暂不可用，将按原请求继续重试');
  }
}
