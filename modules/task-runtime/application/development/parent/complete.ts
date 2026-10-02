import { DomainTopic } from '@crewstation/contracts';
import { z } from 'zod';
import { jsonHash, precondition } from '@crewstation/kernel';
import { requireDevelopmentParentAbsence } from '../../../domain/development/parentAbsence';
import { DevelopmentParentCompletionWitnessSchema } from '../../../domain/development/parentCompletion';
import { developmentParentTransitionHash } from '../../../domain/development/parentEnding';
import type { DevelopmentParentMaterials } from '../../../domain/development/parentMaterials';
import { requireDevelopmentParentStop } from '../../../domain/development/parentMaterials';
import { hashRunnerToken, newRunnerToken } from '../../../domain/runnerToken';
import { occupiesQuota, transition } from '../../../domain/taskEnvironment';
import type { TaskEnvironment } from '../../../domain/taskEnvironment';
import type { DevelopmentParentEndingJobLease } from '../../../ports/developmentParentEndingScope';
import type { TaskRuntimeUseCaseDeps } from '../../dependencies';
import { withDevelopmentParent } from './current';
import { nextParentRebuildEnvironment, originalParentRebuildHash, prepareParentRebuildMaterials } from './rebuildMaterials';

/** Actual physical absence is observed outside locks. Only the actual ending job may make the final Task transition. */
export async function completeDevelopmentParent(deps: TaskRuntimeUseCaseDeps, id: string, identity: DevelopmentParentEndingJobLease, materials: DevelopmentParentMaterials): Promise<void> {
  const original = await deps.uow.read.parentEnding?.endings.get(id), physical = deps.developmentParentPhysical;
  if (!original || original.phase !== 'proved' || !physical || !deps.workloadSafety) throw precondition('原父完成来源尚未装配');
  const state = await deps.workloadSafety.get(id), stopped = requireDevelopmentParentStop(original, materials, state);
  if (!await deps.workloadSafety.admissionClosed(id)) throw precondition('原父观察准入尚未持久关闭');
  const current = () => withDevelopmentParent(deps, id, identity, async (_scope, _environment, ending) => {
    if (ending.phase !== 'proved' || jsonHash(ending.progress['materials']) !== jsonHash(materials)) throw precondition('原父物理清理身份已变化');
  });
  await current(); await physical.removeSecrets(original, materials, current);
  const absence = await physical.absent(original, materials);
  if (!absence) throw precondition('等待原 Pod 与原 owned Secrets 实际消失');
  requireDevelopmentParentAbsence(absence, materials);
  const environment = await deps.uow.read.environments.getById(original.parentId);
  if (!environment) throw precondition('原父 Task 尚未恢复');
  const rebuild = original.operation === 'rebuild' ? await prepareParentRebuildMaterials(deps, original, environment) : undefined;
  await withDevelopmentParent(deps, id, identity, async (scope, parent, ending) => {
    if (ending.phase === 'complete') return;
    if (ending.phase !== 'proved' || jsonHash(ending.progress['materials']) !== jsonHash(materials)
      || jsonHash(ending.progress['stopProofHash']) !== jsonHash(jsonHash(stopped.stopProof))) throw precondition('原父最终停止来源不符');
    const summary = await scope.parentEnding!.children.summary(id);
    if (summary.count !== ending.memberCount || summary.closed !== summary.count || await scope.parentEnding!.children.remaining(id) || await scope.parentEnding!.children.liveUnfinished(id)) throw precondition('原固定成员集合尚未全部闭合');
    const now = deps.clock.now(), pointer = { version: 1, endingId: id, epochHash: ending.epochHash, phase: 'complete' as const };
    let next: TaskEnvironment;
    if (rebuild) {
      const record = await scope.rebuilds.get(rebuild.record.id);
      if (!record || record.state !== 'queued' || originalParentRebuildHash(record) !== rebuild.recordHash) throw precondition('原恢复请求已变化');
      next = nextParentRebuildEnvironment(parent, rebuild, now);
      await scope.rebuilds.update({ ...record, message: '原父物理退出已确认，等待新容器启动', updatedAt: now });
    } else {
      const patch = { parentEnding: pointer, connected: false, runnerTokenHash: hashRunnerToken(newRunnerToken()),
        message: ending.operation === 'compensation' ? String(ending.intent['message'] ?? '恢复失败，原工作卷已保留') : '原子执行和原工作区已确认退出', updatedAt: now };
      next = ending.operation === 'compensation' ? parent.state === 'failed' ? { ...parent, ...patch } : transition(parent, 'failed', now, patch)
        : transition(parent.state === 'releasing' ? parent : transition(parent, 'releasing', now), 'released', now, patch);
    }
    const witness = DevelopmentParentCompletionWitnessSchema.parse({ version: 1, endingId: id,
      outcome: rebuild ? 'rebuild-published' : ending.operation === 'compensation' ? 'compensation' : 'released', epochHash: ending.epochHash,
      podName: ending.epoch.podName, podUid: ending.epoch.podUid, pvcName: ending.epoch.pvcName, pvcUid: ending.epoch.pvcUid,
      originalRenderStart: ending.epoch.originalRenderStart, materialsHash: jsonHash(materials), consumer: stopped.consumer, stopProofHash: jsonHash(stopped.stopProof),
      membership: { revision: 1, count: summary.count, digest: summary.digest }, beforeTransitionHash: developmentParentTransitionHash(parent),
      afterTransitionHash: developmentParentTransitionHash(next), runnerTokenHash: next.runnerTokenHash, completedAt: now.toISOString() });
    const objects = await scope.parentEnding!.objects.list(id);
    const expected = [{ kind: 'Pod', ...materials.pod }, ...materials.secrets.filter((secret) => secret.owned).map((secret) => ({ kind: 'Secret', ...secret }))];
    if (objects.length !== expected.length || expected.some((object) => !objects.some((row) => row.kind === object.kind && row.namespace === materials.namespace
      && row.name === object.name && row.uid === object.uid && row.materialsHash === jsonHash(materials)))) throw precondition('原物理索引集合不完整');
    for (const object of objects) if (!await scope.parentEnding!.objects.absent(object, absence) && jsonHash(object.absence) !== jsonHash(absence))
      throw precondition('原物理索引实际消失证明已变化');
    if (!await scope.parentEnding!.endings.progress(id, 'proved', { ...ending, phase: 'complete', status: 'complete', completionWitness: witness,
      message: next.message ?? null, retryAt: now }, now)) throw precondition('原父结束已被其他作业接续');
    if (rebuild && !occupiesQuota(parent.state)) await scope.quota.acquire(next, rebuild.limit, '项目并发任务配额已满，原工作卷保持');
    await scope.environments.update(next);
    if (rebuild) await scope.rebuildQueue.enqueue(rebuild.record.id);
    else {
      if (occupiesQuota(parent.state)) await scope.quota.release(parent);
      const record = parent.rebuildId ? await scope.rebuilds.get(parent.rebuildId) : undefined;
      if (ending.operation === 'compensation' && record) await scope.rebuilds.update({ ...record, state: 'failed', message: next.message, failureReason: next.message, updatedAt: now });
      if (ending.operation !== 'compensation') await scope.events.publish(DomainTopic.taskReleased, { occurredAt: now.toISOString(), traceId: parent.traceId, projectId: parent.projectId,
        taskId: parent.id, kind: parent.kind, reason: z.enum(['user', 'owner-force', 'business', 'failed', 'pod-lost', 'profile-test']).parse(ending.operation === 'retention' ? 'failed' : ending.intent['reason']) });
    }
  });
}
