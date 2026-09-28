import { TaskIdSchema, TraceIdSchema } from '@crewstation/contracts';
import { jsonHash, notFound, precondition, validation } from '@crewstation/kernel';
import type { RestartBusinessWorkspaceInput } from '../../api/businessRecovery';
import type { TaskEnvironment } from '../../domain/taskEnvironment';
import { podNameFor, pvcNameFor } from '../../domain/taskEnvironment';
import { initialStartup } from '../../domain/podStartup';
import { hashRunnerToken, newRunnerToken } from '../../domain/runnerToken';
import type { TaskRuntimeUseCaseDeps } from '../dependencies';
import { admitEnvironment, matchAdmission } from '../environmentAdmission';
import { inspectBusinessRecovery } from './recoveryInspection';
import { storageStart } from './storageStart';
import { assertBusinessStorageMutable } from './finalizationGuard';

/** A new workspace with the original execution materials; never copy the old volume or success state. */
export function restartBusinessWorkspace(deps: TaskRuntimeUseCaseDeps) {
  const inspect = inspectBusinessRecovery(deps);
  return async (input: RestartBusinessWorkspaceInput): Promise<TaskEnvironment> => {
    TaskIdSchema.parse(input.newTaskId); TraceIdSchema.parse(input.traceId);
    if (deps.creation !== 'ledger' || input.newTaskId === input.taskId || !/^[a-f0-9]{64}$/.test(input.fingerprint)) throw validation('重新执行需要独立任务 ID 和固定准入摘要');
    const fingerprint = jsonHash({ kind: 'business-restart', ...input, traceId: undefined });
    const replay = matchAdmission(await deps.uow.read.environments.getById(input.newTaskId), fingerprint);
    if (replay) return replay;
    const original = await deps.uow.read.environments.getById(input.taskId);
    if (!original || original.projectId !== input.projectId || original.serviceId !== input.serviceId) throw notFound('原业务工作区', input.taskId);
    assertBusinessStorageMutable(original);
    if (original.kind !== 'business' || original.native || original.state !== 'failed' || !original.render?.businessStorage || original.render.businessStorage.ownerTaskId !== original.id) throw precondition('只有失败的独立业务工作区可以重新执行');
    const proof = await inspect(input);
    if (!proof?.stopped) throw precondition('旧执行尚未确认停止', { code: 'workspace_cleanup_pending' });
    if (proof.activeChildren) throw precondition('原工作区仍有活动子执行', { code: 'active_subtasks' });
    if (proof.volumeVerified) throw precondition('原工作卷仍可恢复，应使用保留工作区的恢复动作', { code: 'original_workspace_available' });
    const limit = (await deps.quotas.quotaLimit(original.projectId)) ?? 0, now = deps.clock.now(), pinned = original.render;
    const restarted: TaskEnvironment = {
      id: input.newTaskId, projectId: original.projectId, serviceId: original.serviceId, kind: 'business', state: 'creating',
      volumeMode: original.volumeMode, profile: original.profile, namespace: original.namespace, labels: original.labels,
      podName: podNameFor(input.newTaskId), pvcName: pvcNameFor(input.newTaskId), traceId: input.traceId, admissionFingerprint: fingerprint,
      connected: false, runnerTokenHash: hashRunnerToken(newRunnerToken()), startup: initialStartup(now),
      createdAt: now, updatedAt: now, lastActivityAt: now,
      render: { image: pinned.image, workerUid: pinned.workerUid, resources: pinned.resources, start: 1, ...storageStart(pinned.completionPolicy),
        ...(pinned.objectInputsGeneration ? { objectInputsGeneration: 1 } : {}),
        ...(pinned.runtimeImage ? { runtimeImage: pinned.runtimeImage } : {}), businessStorage: { version: 1, ownerTaskId: input.newTaskId } },
    };
    return admitEnvironment(deps, restarted, limit, original);
  };
}
