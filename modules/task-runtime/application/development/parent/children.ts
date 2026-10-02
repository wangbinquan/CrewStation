import { jsonHash, isPlatformError, precondition } from '@crewstation/kernel';
import { DevelopmentCleanupEvidenceSchema, requireDevelopmentCleanupEvidence } from '../../../domain/development/cleanupEvidence';
import { developmentCleanupSelection } from '../../../domain/development/cleanupSelection';
import { requireDevelopmentRemovalEvidence } from '../../../domain/development/removalEvidence';
import { canonicalNativeIntent } from '../../../domain/physicalIdentity';
import type { NativeExecution, TaskEnvironment } from '../../../domain/taskEnvironment';
import type { DevelopmentParentEnding, DevelopmentParentEndingChild } from '../../../ports/developmentParentEnding';
import type { DevelopmentParentEndingJobLease } from '../../../ports/developmentParentEndingScope';
import type { TaskRuntimeUseCaseDeps } from '../../dependencies';
import { scheduleExecutionCleanup } from '../../nativeExecution';
import { developmentPhysicalStop } from '../workloadStop';
import { advanceDevelopmentParent, withDevelopmentParent } from './current';

function acceptedRender(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object' || Array.isArray(value)) throw precondition('原固定成员 render 不是完整对象');
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['runtimeConnectionDeadline', 'runtimeInitializationDeadline'].includes(key)));
}
function originalMember(member: DevelopmentParentEndingChild, current: TaskEnvironment): void {
  const s = member.snapshot, n = s['native'] as NativeExecution | undefined;
  if (s['renderPresent'] === true && (!s['render'] || typeof s['render'] !== 'object' || Array.isArray(s['render']))) throw precondition('原固定成员 render 显式材料无效');
  if (!n || typeof n !== 'object' || s['id'] !== member.childId || current.id !== member.childId || s['project_id'] !== current.projectId
    || s['service_id'] !== current.serviceId || s['namespace'] !== current.namespace || s['pod_name'] !== current.podName || s['pvc_name'] !== current.pvcName
    || !current.native || n.parentTaskId !== current.native.parentTaskId || n.parentPodUid !== current.native.parentPodUid
    || n.parentPodUid !== member.originalParentPodUid || n.pvcUid !== current.native.pvcUid
    || canonicalNativeIntent(current.id, n) !== canonicalNativeIntent(current.id, current.native)
    || jsonHash(acceptedRender(s['render'])) !== jsonHash(acceptedRender(current.render ?? null))) throw precondition('原父固定成员的执行身份已变化');
}
async function closure(deps: TaskRuntimeUseCaseDeps, member: DevelopmentParentEndingChild, environment: TaskEnvironment) {
  originalMember(member, environment);
  if (environment.native?.state !== 'finished') return undefined;
  if (environment.render?.developmentUsageProtection === undefined) return { version: 1, kind: 'legacy-finished', originalParentPodUid: member.originalParentPodUid };
  const n = member.snapshot['native'] as NativeExecution;
  const original = environment.render.developmentRemovalProtection !== undefined ? requireDevelopmentRemovalEvidence(environment).original : undefined;
  const selection = original ? developmentCleanupSelection(original)
    : n.state === 'finished' ? DevelopmentCleanupEvidenceSchema.parse(n.developmentCleanup).selection
      : developmentCleanupSelection({ ...environment, runnerTokenHash: String(member.snapshot['runner_token_hash']), state: 'releasing', native: { ...environment.native, state: 'cleaning' } });
  if (!selection || n.podUid && n.podUid !== selection.podUid) throw precondition('原固定成员缺少数字退出选择');
  const evidence = requireDevelopmentCleanupEvidence(environment.native.developmentCleanup, selection);
  if (n.state === 'finished' && jsonHash(n.developmentCleanup) !== jsonHash(evidence)) throw precondition('原已结束成员的数字回执不可替换');
  const stopped = await developmentPhysicalStop(deps.workloadSafety, environment);
  return { version: 1, kind: 'protected-closed', selectionHash: selection.selectionHash, originalParentPodUid: member.originalParentPodUid,
    numericDigest: jsonHash(evidence), numericEvidence: evidence, numericStatus: evidence.closure.status, tailUnknown: evidence.closure.tailUnknown, stopProofDigest: jsonHash(stopped.stopProof) };
}
async function advanceMember(deps: TaskRuntimeUseCaseDeps, ending: DevelopmentParentEnding,
  member: DevelopmentParentEndingChild, identity: DevelopmentParentEndingJobLease) {
  const environment = await deps.uow.read.environments.getById(member.childId);
  if (!environment) throw precondition('原固定成员尚未恢复，不能当作已经退出');
  originalMember(member, environment);
  const closed = await closure(deps, member, environment);
  if (!member.originalParentPodUid || member.originalParentPodUid !== ending.epoch.podUid && closed?.kind !== 'protected-closed')
    throw precondition('其他 epoch 或未绑定成员缺少自己的完整退出证明');
  await withDevelopmentParent(deps, ending.id, identity, async (scope, _parent, current) => {
    if (current.phase !== 'children') return;
    const child = await scope.environments.getForUpdate(member.childId);
    if (!child) throw precondition('原固定成员已缺失');
    originalMember(member, child);
    if (closed) {
      if (child.native?.state !== 'finished' || jsonHash(child.native.developmentCleanup ?? null) !== jsonHash(environment.native?.developmentCleanup ?? null))
        throw precondition('原固定成员闭合后身份已变化');
      await scope.parentEnding!.children.close(ending.id, member.childId, closed);
    } else await scheduleExecutionCleanup(scope, child, deps.clock.now());
  });
}
/** One bounded page per actual ending job. Malformed/waiting prefixes cannot monopolize the durable cursor. */
export async function advanceDevelopmentParentChildren(deps: TaskRuntimeUseCaseDeps, id: string, identity: DevelopmentParentEndingJobLease): Promise<boolean> {
  const ending = await deps.uow.read.parentEnding?.endings.get(id);
  if (!ending || ending.phase !== 'children') return false;
  const page = await deps.uow.read.parentEnding!.children.page(id, ending.afterChildId ?? undefined);
  let waitingMember: { childId: string; reason: string } | undefined;
  for (const member of page) {
    try { await advanceMember(deps, ending, member, identity); }
    catch (error) {
      if (isPlatformError(error) && error.details?.['code'] === 'development_parent_job_lease_lost') throw error;
      waitingMember = { childId: member.childId, reason: isPlatformError(error) ? error.message : '原成员退出来源暂不可用' };
    }
  }
  return withDevelopmentParent(deps, id, identity, async (scope, environment, current) => {
    if (current.phase !== 'children') return false;
    const remaining = await scope.parentEnding!.children.remaining(id), now = deps.clock.now();
    await advanceDevelopmentParent(scope, environment, current, { ...current, afterChildId: page.at(-1)?.childId ?? null,
      progress: { ...current.progress, ...(waitingMember ? { waitingMember } : {}) },
      message: remaining ? `等待原固定成员退出（${remaining}）` : '原固定成员已闭合，准备原父物理观察', retryAt: new Date(now.getTime() + 2_000) }, now);
    return remaining === 0;
  });
}
