import { dispatchBusinessAgent } from './agentDispatch';
import { prepareAgentPlan } from './agentPlan';
import { prepareAgentFreshRetry } from './agentResume';
import { admitWithRuntimeImage } from '../taskRuntimeImage';
import { subtaskResponse } from './subtasks';
import type { TaskId, BusinessSubtaskV3Dto } from '@crewstation/contracts';
import type { ExecutionAgentPlan } from '../../domain/executionAgent';
import { BusinessExecutionInfoSchema, SubmitBusinessSubtaskV3Schema } from '@crewstation/contracts';
import { conflict, jsonHash, newResourceId, notFound, precondition } from '@crewstation/kernel';
import type { BusinessExecutionApi } from '../../api/executionApi';
import type { BusinessExecutionDeps } from './dependencies';
import { executionSource } from './source';
import { assertExecutionFence } from '../../domain/executionControl';
import { dispatchBusinessCommand } from './commandDispatch';

/** A fresh retry has its own immutable identity; old attempts and their event history remain unchanged. */
export function executionRetryUseCases(deps: BusinessExecutionDeps): Pick<BusinessExecutionApi, 'retrySubtask'> {
  const source = executionSource(deps);
  return {
    retrySubtask: async (caller, taskId, subtaskId, input) => {
      const context = await source(caller);
      const parent = await deps.operations.forTask(context.serviceId, taskId);
      if (!parent) throw notFound('业务任务', taskId);
      const { requestKey, fence, ...parameters } = input, digest = jsonHash(parameters);
      const accepted = await deps.subtasks.find(context.serviceId, taskId, requestKey, 'retry', subtaskId);
      if (accepted) {
        if (accepted.requestDigest !== digest) throw conflict('重试幂等键参数不同', { code: 'idempotency_conflict' });
        const replay = fence || accepted.dispatch === 'retryable-rejected' ? await deps.subtasks.adoptPending(accepted, { source: context.authority, fence }) : accepted;
        if (accepted.dispatch === 'retryable-rejected') { const claim = await deps.subtasks.claim(newResourceId(), replay.view.id); if (claim) await dispatchBusinessAgent(deps, claim); }
        return subtaskResponse((await deps.subtasks.get(context.serviceId, taskId, replay.view.id))!, false);
      }
      const previous = await deps.subtasks.get(context.serviceId, taskId, subtaskId);
      if (!previous) throw notFound('业务子任务', subtaskId);
      const authorization = { source: context.authority, ...(fence ? { fence } : {}) }, control = await deps.controls.read(context.serviceId);
      if (previous.fenced || control.control) assertExecutionFence(control.control, authorization, control.now);
      if (previous.view.attempt !== input.expectedAttempt || !['succeeded', 'failed', 'cancelled'].includes(previous.view.state)) throw conflict('只能重试已终结且 attempt 匹配的子任务', { code: 'stale_generation' });
      if (previous.view.kind === 'command' && input.resumePolicy !== 'fresh') throw precondition('当前执行不支持该续跑策略', { code: 'capability_unsupported' });
      const env = await deps.environments.getEnvironment(taskId);
      if (env?.state === 'paused') throw conflict('任务已暂停', { code: 'task_paused' });
      if (env?.state !== 'running' || !env.connected) throw precondition('工作区当前不可执行', { code: 'workspace_unavailable' });
      BusinessExecutionInfoSchema.parse(await deps.runner.sendCommand(taskId, { id: newResourceId(), type: 'businessExecutionInfo' }));
      const stored = JSON.parse(await deps.cipher.open(previous.sealedPayload));
      const payload = SubmitBusinessSubtaskV3Schema.parse(previous.view.kind === 'agent' ? (stored as ExecutionAgentPlan).request : stored);
      const { id: _id, previousId: _previous, result: _result, error: _error, startedAt: _started, endedAt: _ended, cancelRequestedAt: _cancelled, sessionId: _session, ...stable } = previous.view;
      const view: BusinessSubtaskV3Dto = { ...stable, id: newResourceId() as typeof previous.view.id, previousId: previous.view.id, executionId: newResourceId(), attempt: previous.view.attempt + 1, state: 'pending', process: 'not-started', createdAt: deps.clock.now().toISOString() };
      const runtimeTaskId = payload.kind === 'agent' ? newResourceId() as TaskId : undefined;
      const agent = payload.kind !== 'agent' ? undefined : input.resumePolicy === 'fresh'
        ? await prepareAgentFreshRetry(deps, previous, stored, view, runtimeTaskId!, { ...payload, requestKey, fence, resumeSessionId: undefined })
        : await prepareAgentPlan(deps, parent, context.serviceId, view, runtimeTaskId!, { ...payload, requestKey, fence, resumeSessionId: input.resumeSessionId });
      const saved = await admitWithRuntimeImage(deps.runtimeImages, agent?.plan.runtimeImage, { type: 'agent', id: runtimeTaskId! }, async () => {
        if (input.resumePolicy === 'resume' && agent?.plan.sessionKey !== previous.sessionKey) throw conflict('重试只能恢复原 attempt 的会话目录', { code: 'session_incompatible' });
        return deps.subtasks.reserve({ serviceId: context.serviceId, taskId, requestKind: 'retry', requestParent: subtaskId, requestKey, requestDigest: digest,
        ...(agent ? { runtimeTaskId, sessionKey: agent.plan.sessionKey, sessionVolumeUid: agent.plan.volumeUid } : {}),
        sealedPayload: await deps.cipher.seal(JSON.stringify(agent?.plan ?? { ...payload, requestKey })), payloadDigest: agent?.payloadDigest ?? previous.payloadDigest, fenced: previous.fenced, epoch: fence?.epoch ?? null,
        view: agent?.view ?? view,
        }, authorization);
      }, (result) => result.subtask.runtimeTaskId);
      const claim = await deps.subtasks.claim(newResourceId(), saved.subtask.view.id);
      if (claim) { if (claim.view.kind === 'agent') await dispatchBusinessAgent(deps, claim); else await dispatchBusinessCommand(deps, claim); }
      return subtaskResponse((await deps.subtasks.get(context.serviceId, taskId, saved.subtask.view.id))!, saved.created);
    },
  };
}
