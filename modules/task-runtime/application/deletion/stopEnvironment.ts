import type { ProjectDeletionContext } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { TaskEnvironment } from '../../domain/taskEnvironment';
import type { NativeExecutionJobLease } from '../../ports/unitOfWork';
import type { RuntimeOriginalStopSources } from '../../ports/deletion/originalStop';
import type { NativeExecutionDeps } from '../nativeExecution';
import { cleanupDevelopmentWorkload } from '../development/cleanup';
import { closeStorageAdmission, storageStopProved } from '../business/storageStop';

/** State, digital receipts and token invalidation may advance; original workload selection must stay fixed. */
export const originalStopIdentity = (env: TaskEnvironment) => jsonHash({ id: env.id, projectId: env.projectId, serviceId: env.serviceId,
  kind: env.kind, namespace: env.namespace, podName: env.podName, podUid: env.podUid ?? null, pvcName: env.pvcName,
  profile: env.profile, volumeMode: env.volumeMode, render: env.render ?? null, legacyCluster: env.legacyCluster ?? null, labels: env.labels,
  native: env.native ? { parentTaskId: env.native.parentTaskId,
    agentId: env.native.agentId, runnerId: env.native.runnerId, fingerprint: env.native.fingerprint,
    podUid: env.native.podUid ?? null, secretUid: env.native.secretUid ?? null, profile: env.native.profile,
    image: env.native.image, computeProfile: env.native.computeProfile ?? null } : null });

async function current(deps: NativeExecutionDeps, original: TaskEnvironment, identity: NativeExecutionJobLease | undefined,
  update?: (env: TaskEnvironment) => TaskEnvironment): Promise<TaskEnvironment> {
  return deps.uow.run(async (scope) => {
    await scope.admissions.lock(original.projectId);
    if (identity && !scope.nativeLease) throw precondition('项目删除需要原运行作业的持久租约');
    if (identity) await scope.nativeLease!.requireCurrent(identity, original.id);
    const env = await scope.environments.getById(original.id);
    if (!env || originalStopIdentity(env) !== originalStopIdentity(original)) throw precondition('原项目执行实例已经改变');
    const next = update?.(env) ?? env;
    if (next !== env) await scope.environments.update(next);
    if (identity) await scope.nativeLease!.requireCurrent(identity, original.id);
    return next;
  });
}
/** No enqueue/create or PVC operation is reachable through this project STOP path. */
export async function stopOriginalEnvironment(deps: NativeExecutionDeps, sources: RuntimeOriginalStopSources, context: ProjectDeletionContext,
  original: TaskEnvironment, identity: NativeExecutionJobLease | undefined, heartbeat: () => Promise<boolean>): Promise<{ digest: string } | { waiting: string }> {
  const fence = async () => { if (!await heartbeat()) throw precondition('原清理作业租约已失效'); await current(deps, original, identity); };
  await fence();
  if (original.render?.developmentUsageProtection === undefined) {
    const digital = await sources.digital(context, original);
    if (digital.kind === 'waiting') return { waiting: digital.reason };
  }
  let env = await current(deps, original, identity, (value) => {
    if (value.native?.state === 'finished' || !value.native && value.state === 'released') return value;
    return { ...value, state: 'releasing', ...(value.native ? { native: { ...value.native, state: 'cleaning' } } : {}), updatedAt: deps.clock.now() };
  });
  if (env.render?.developmentUsageProtection !== undefined && env.native?.state !== 'finished') {
    await cleanupDevelopmentWorkload({ ...deps, developmentCleanup: sources.development(context) }, env, heartbeat, identity);
  } else if (env.native?.state !== 'finished' && env.state !== 'released') {
    await closeStorageAdmission(deps, env); await fence();
    if (env.native) await deps.nativeCluster.cleanup(env);
    else await deps.cluster.deletePod(env);
    await fence();
    if ((await deps.cluster.podPhase(env)).phase !== 'Missing') return { waiting: '等待原执行 Pod 完整退出' };
    if (!await storageStopProved(deps, env)) return { waiting: '等待原工作卷消费者停止证明' };
  }
  await fence();
  const stopped = await sources.stopped(context, env);
  if (!stopped) return { waiting: '等待原完整 Pod 或原未启动准入的独立停止证明' };
  if (!/^[a-f0-9]{64}$/.test(stopped.digest)) throw precondition('原执行停止证明摘要无效');
  env = await current(deps, original, identity, (value) => value.state === 'released' || value.native?.state === 'finished' ? value
    : { ...value, state: 'released', connected: false, ...(value.native ? { native: { ...value.native, state: 'finished' } } : {}), updatedAt: deps.clock.now() });
  return { digest: jsonHash({ task: originalStopIdentity(env), stop: stopped.digest }) };
}
