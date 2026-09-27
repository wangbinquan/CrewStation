import type { Actor, TaskId } from '@crewstation/contracts';
import { RequestBusinessRecoverySchema, BusinessRecoveryTaskDetailSchema } from '@crewstation/contracts';
import { conflict, forbidden, jsonHash, notFound, precondition, validation } from '@crewstation/kernel';
import type { BusinessTaskRecoveryApi } from '../../api/taskRecovery';
import type { RecoveryQueries } from '../../ports/taskRecovery';
import type { BusinessExecutionDeps } from '../execution/dependencies';
import { assessRecovery } from './assessment';
import { admissionTaskView } from '../execution/taskView';

export function recoveryAdminUseCases(deps: BusinessExecutionDeps, queries: RecoveryQueries): BusinessTaskRecoveryApi {
  const task = async (actor: Actor, taskId: TaskId) => {
    if (!actor.isAdmin) throw forbidden('业务执行恢复仅供平台管理员');
    const parent = await queries.task(taskId);
    if (!parent) throw notFound('业务任务', taskId);
    return parent;
  };
  return {
    describeRecoveryTask: async (actor, taskId) => {
      const parent = await task(actor, taskId);
      return BusinessRecoveryTaskDetailSchema.parse({ task: await admissionTaskView(deps, parent), subtasks: (await deps.subtasks.list(parent.serviceId, taskId)).map((child) => child.view) });
    },
    assessTaskRecovery: async (actor, taskId, subtaskId) => (await assessRecovery(deps, queries, await task(actor, taskId), subtaskId)).assessment,
    listTaskRecoveries: async (actor, taskId) => { const parent = await task(actor, taskId); return deps.recoveryRequests!.list(parent.serviceId, taskId, 100); },
    requestTaskRecovery: async (actor, taskId, input) => {
      const parent = await task(actor, taskId), request = RequestBusinessRecoverySchema.parse(input);
      if (request.target.taskId !== taskId) throw validation('请求目标与当前任务不一致');
      const replay = async () => {
        const old = await deps.recoveryRequests!.find(parent.serviceId, request.requestKey);
        if (old && jsonHash({ requestKey: old.requestKey, target: old.target, assessmentDigest: old.assessmentDigest }) !== jsonHash(request)) throw conflict('同一恢复 requestKey 已用于不同内容', { code: 'idempotency_conflict' });
        return old;
      };
      const old = await replay(); if (old) return old;
      const { assessment, epoch } = await assessRecovery(deps, queries, parent, 'subtaskId' in request.target ? request.target.subtaskId : undefined);
      const option = assessment.actions.find((a) => jsonHash(a.target) === jsonHash(request.target) && a.assessmentDigest === request.assessmentDigest);
      if (!option) {
        // Another identical click may commit while this request is inspecting physical resources.
        const concurrent = await replay(); if (concurrent) return concurrent;
        throw precondition('恢复条件已变化，请重新查看任务', { code: 'recovery_assessment_stale', reasons: assessment.reasons });
      }
      return deps.recoveryRequests!.request({ serviceId: parent.serviceId, projectId: parent.intent.projectId, requestedBy: actor.userId, request, assessmentDigest: option.assessmentDigest, controlEpoch: epoch });
    },
  };
}
