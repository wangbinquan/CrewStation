import { jsonHash, precondition } from '@crewstation/kernel';
import { createDevelopmentRemovalSeal } from '../../domain/development/removalEvidence';
import { developmentCleanupSelection } from '../../domain/development/cleanupSelection';
import { requireDevelopmentCleanupEvidence } from '../../domain/development/cleanupEvidence';
import type { DevelopmentCleanupEvidence, DevelopmentCleanupSelection } from '../../domain/development/cleanupEvidence';
import { hashRunnerToken, newRunnerToken } from '../../domain/runnerToken';
import type { TaskEnvironment } from '../../domain/taskEnvironment';
import { occupiesQuota } from '../../domain/taskEnvironment';
import type { NativeExecutionCluster } from '../../ports/cluster';
import type { RepositoryScope, NativeExecutionJobLease } from '../../ports/unitOfWork';
import type { TaskRuntimeUseCaseDeps } from '../dependencies';
import { closeDevelopmentAdmission, developmentPhysicalStop, developmentAdmissionSecretUid, developmentHasStartPermit, developmentNoGrant, developmentPrestartPhysicalStop } from './workloadStop';

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
function prestartBase(evidence: DevelopmentCleanupEvidence) {
  return evidence.version === 2 ? { ...evidence, phase: 'stopping', stopProof: null, stopProofDigest: null } : evidence;
}
/** Only the same no-grant stopping proof may advance to closed; all other evidence replacement is a conflict. */
async function saveEvidence(deps: Deps, original: TaskEnvironment, identity: NativeExecutionJobLease | undefined, selection: DevelopmentCleanupSelection, evidence: DevelopmentCleanupEvidence) {
  return withCurrent(deps, original, identity, selection, async (scope, env) => {
    const old = env.native!.developmentCleanup && requireDevelopmentCleanupEvidence(env.native!.developmentCleanup, selection);
    if (old && jsonHash(old) === jsonHash(evidence)) return env;
    if (old && !(old.version === 2 && old.phase === 'stopping' && evidence.version === 2 && evidence.phase === 'closed'
      && jsonHash(prestartBase(old)) === jsonHash(prestartBase(evidence)))) throw precondition('原开发清理凭证不可替换');
    const next = { ...env, native: { ...env.native!, developmentCleanup: evidence }, updatedAt: deps.clock.now() };
    await scope.environments.update(next); return next;
  });
}
async function finishCleanup(deps: Deps, original: TaskEnvironment, identity: NativeExecutionJobLease | undefined, selection: DevelopmentCleanupSelection, evidence: DevelopmentCleanupEvidence) {
  if (evidence.version === 2) {
    const stop = await developmentPrestartPhysicalStop(deps.workloadSafety, original);
    if (evidence.phase !== 'closed' || jsonHash(stop.stopProof) !== evidence.stopProofDigest) throw precondition('未获准启动释放尚无匹配实际物理闭合');
  }
  await withCurrent(deps, original, identity, selection, async (scope, env) => {
    const n = env.native!, now = deps.clock.now();
    if (jsonHash(requireDevelopmentCleanupEvidence(n.developmentCleanup, selection)) !== jsonHash(evidence)) throw precondition('最终释放的原数字许可已冲突');
    await scope.environments.update({ ...env, state: n.failureReason ? 'failed' : 'released', connected: false, updatedAt: now,
      runnerTokenHash: hashRunnerToken(newRunnerToken()), native: { ...n, state: 'finished', ...(env.render?.developmentRemovalProtection !== undefined ? { developmentRemovalSeal: createDevelopmentRemovalSeal(env) } : {}) }, message: n.failureReason ?? '此 Agent 的原执行环境已回收，工作树保持' });
    if (occupiesQuota(env.state)) await scope.quota.release(env);
  });
}
/** Real job fence at every commit; participant/Resources/Session/Kubernetes I/O stays outside project locks. */
export async function cleanupDevelopmentWorkload(deps: Deps, original: TaskEnvironment, renew: () => Promise<boolean>, identity: NativeExecutionJobLease | undefined): Promise<void> {
  const selection = developmentCleanupSelection(original);
  if (!selection || !deps.developmentCleanup || !deps.nativeCluster.cleanupDevelopment) throw precondition('等待开发数字排空与原执行停止屏障装配', { code: 'runtime_original_stop_waiting' });
  await requireHeartbeat(renew);
  let current = await withCurrent(deps, original, identity, selection, async (_scope, env) => env);
  const noGrant = !await developmentHasStartPermit(deps.workloadSafety, current);
  if (noGrant) { await closeDevelopmentAdmission(deps.workloadSafety, current); await developmentNoGrant(deps.workloadSafety, current); }
  else await developmentAdmissionSecretUid(deps.workloadSafety, current);
  if (!current.native!.developmentCleanup) {
    const result = await deps.developmentCleanup.advance(selection);
    if (result.kind !== 'permitted') throw precondition('等待开发数字排空的持久出口：' + result.reason, { code: 'runtime_original_stop_waiting' });
    const evidence = requireDevelopmentCleanupEvidence(result.evidence, selection);
    if (noGrant !== (evidence.version === 2)) throw precondition('原准入事实与开发清理出口不匹配');
    if (noGrant) await developmentNoGrant(deps.workloadSafety, current);
    await requireHeartbeat(renew); current = await saveEvidence(deps, original, identity, selection, evidence);
  }
  let evidence = requireDevelopmentCleanupEvidence(current.native!.developmentCleanup, selection);
  if (noGrant !== (evidence.version === 2)) throw precondition('原准入事实与已保存清理出口不匹配');
  const fence = async () => {
    await requireHeartbeat(renew);
    await withCurrent(deps, original, identity, selection, async (_scope, env) => {
      if (jsonHash(requireDevelopmentCleanupEvidence(env.native!.developmentCleanup, selection)) !== jsonHash(evidence)) throw precondition('原开发清理许可已冲突');
    });
    if (noGrant) await developmentNoGrant(deps.workloadSafety, current);
    else await developmentAdmissionSecretUid(deps.workloadSafety, current);
  };
  const beforeCredentials = async () => {
    await fence();
    const complete = deps.developmentCleanup!.completePrestart;
    if (!complete) throw precondition('等待原 Dev 未获准启动闭合能力', { code: 'runtime_original_stop_waiting' });
    const result = await Reflect.apply(complete, deps.developmentCleanup!, [selection]);
    if (result.kind !== 'permitted') throw precondition('等待原未获准启动闭合：' + result.reason, { code: 'runtime_original_stop_waiting' });
    const next = requireDevelopmentCleanupEvidence(result.evidence, selection), stop = await developmentPrestartPhysicalStop(deps.workloadSafety, current);
    if (next.version !== 2 || next.phase !== 'closed' || jsonHash(prestartBase(next)) !== jsonHash(prestartBase(evidence))
      || next.stopProofDigest !== jsonHash(stop.stopProof)) throw precondition('原未获准启动闭合与原实际停止证明冲突');
    await fence(); current = await saveEvidence(deps, original, identity, selection, next); evidence = next;
  };
  await fence(); await closeDevelopmentAdmission(deps.workloadSafety, current);
  await deps.nativeCluster.cleanupDevelopment(current, { current: fence, stopped: () => noGrant ? developmentPrestartPhysicalStop(deps.workloadSafety, current) : developmentPhysicalStop(deps.workloadSafety, current),
    ...(noGrant ? { beforeCredentials } : current.render?.developmentRemovalProtection !== undefined ? { admissionSecretUid: async () => { const uid = await developmentAdmissionSecretUid(deps.workloadSafety, current); if (!uid) throw precondition('原准入 UID 回执缺失'); return uid; } } : {}) });
  await fence(); await finishCleanup(deps, original, identity, selection, evidence);
}
