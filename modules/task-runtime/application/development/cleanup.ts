import { jsonHash, precondition } from '@crewstation/kernel';
import { developmentCleanupSelection } from '../../domain/development/cleanupSelection';
import { requireDevelopmentCleanupEvidence } from '../../domain/development/cleanupEvidence';
import type { DevelopmentCleanupSelection } from '../../domain/development/cleanupEvidence';
import { hashRunnerToken, newRunnerToken } from '../../domain/runnerToken';
import type { TaskEnvironment } from '../../domain/taskEnvironment';
import { occupiesQuota } from '../../domain/taskEnvironment';
import type { NativeExecutionCluster } from '../../ports/cluster';
import type { RepositoryScope, NativeExecutionJobLease } from '../../ports/unitOfWork';
import type { TaskRuntimeUseCaseDeps } from '../dependencies';
import { closeDevelopmentAdmission, developmentPhysicalStop } from './workloadStop';

type Deps = TaskRuntimeUseCaseDeps & { nativeCluster: NativeExecutionCluster };
async function withCurrent<T>(deps: Deps, original: TaskEnvironment, identity: NativeExecutionJobLease | undefined, selection: DevelopmentCleanupSelection,
  operation: (scope: RepositoryScope, current: TaskEnvironment) => Promise<T>): Promise<T> {
  if (!identity || !Number.isSafeInteger(identity.jobId) || identity.jobId <= 0 || !Number.isSafeInteger(identity.fencingToken) || identity.fencingToken <= 0) throw precondition('开发清理需要实际持久作业租约');
  return deps.uow.run(async (scope) => {
    await scope.admissions.lock(original.projectId);
    if (!scope.nativeLease) throw precondition('开发清理作业事务保护未装配');
    await scope.nativeLease.requireCurrent(identity, original.id);
    const current = await scope.environments.getById(original.id), selected = current && developmentCleanupSelection(current);
    if (!current || !selected || jsonHash(selected) !== jsonHash(selection)) throw precondition('开发清理期间原选择已改变');
    const value = await operation(scope, current);
    await scope.nativeLease.requireCurrent(identity, original.id);
    return value;
  });
}
async function requireHeartbeat(renew: () => Promise<boolean>): Promise<void> {
  if (!await renew()) throw precondition('开发清理作业租约已被接管');
}
/** Real job fence at both commits; all participant, Session and Kubernetes I/O is outside project locks. */
export async function cleanupDevelopmentWorkload(deps: Deps, original: TaskEnvironment, renew: () => Promise<boolean>, identity: NativeExecutionJobLease | undefined): Promise<void> {
  const selection = developmentCleanupSelection(original);
  if (!selection || !deps.developmentCleanup || !deps.nativeCluster.cleanupDevelopment) throw precondition('等待开发数字排空与原执行停止屏障装配');
  await requireHeartbeat(renew);
  let current = await withCurrent(deps, original, identity, selection, async (_scope, env) => env);
  if (!current.native!.developmentCleanup) {
    const result = await deps.developmentCleanup.advance(selection);
    if (result.kind !== 'permitted') throw precondition('等待开发数字排空的持久出口');
    const evidence = requireDevelopmentCleanupEvidence(result.evidence, selection);
    await requireHeartbeat(renew);
    current = await withCurrent(deps, original, identity, selection, async (scope, env) => {
      if (env.native!.developmentCleanup && jsonHash(requireDevelopmentCleanupEvidence(env.native!.developmentCleanup, selection)) !== jsonHash(evidence)) throw precondition('原开发数字清理凭证不可替换');
      if (env.native!.developmentCleanup) return env;
      const next = { ...env, native: { ...env.native!, developmentCleanup: evidence }, updatedAt: deps.clock.now() };
      await scope.environments.update(next); return next;
    });
  }
  const evidence = requireDevelopmentCleanupEvidence(current.native!.developmentCleanup, selection);
  const fence = async () => {
    await requireHeartbeat(renew);
    await withCurrent(deps, original, identity, selection, async (_scope, env) => {
      if (jsonHash(requireDevelopmentCleanupEvidence(env.native!.developmentCleanup, selection)) !== jsonHash(evidence)) throw precondition('原开发清理许可已冲突');
    });
  };
  await fence(); await closeDevelopmentAdmission(deps.workloadSafety, current);
  await deps.nativeCluster.cleanupDevelopment(current, { current: fence, stopped: () => developmentPhysicalStop(deps.workloadSafety, current) });
  await fence();
  await withCurrent(deps, original, identity, selection, async (scope, env) => {
    const n = env.native!, now = deps.clock.now();
    if (jsonHash(requireDevelopmentCleanupEvidence(n.developmentCleanup, selection)) !== jsonHash(evidence)) throw precondition('最终释放的原数字许可已冲突');
    await scope.environments.update({ ...env, state: n.failureReason ? 'failed' : 'released', connected: false, updatedAt: now,
      runnerTokenHash: hashRunnerToken(newRunnerToken()), native: { ...n, state: 'finished' }, message: n.failureReason ?? '此 Agent 的原执行环境已回收，工作树保持' });
    if (occupiesQuota(env.state)) await scope.quota.release(env);
  });
}
