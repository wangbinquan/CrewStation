import { acceptSubtaskObservation, prepareAgentPlan } from './agentPlan';
import { admitWithRuntimeImage } from '../taskRuntimeImage';
import { dispatchBusinessAgent, cleanupAgentEnvironments } from './agentDispatch';
import { businessCommandDigestInput, BusinessExecutionInfoSchema } from '@crewstation/contracts';
import type { BusinessSubtaskV3Dto, SubmitBusinessSubtaskV3, SubtaskId, TaskId } from '@crewstation/contracts';
import { quotaExceeded, conflict, jsonHash, newResourceId, notFound, precondition } from '@crewstation/kernel';
import type { BusinessExecutionApi, BusinessExecutionCaller } from '../../api/executionApi';
import type { BusinessExecutionDeps } from './dependencies';
import type { ExecutionSubtask } from '../../domain/executionSubtask';
import { assertExecutionFence } from '../../domain/executionControl';
import { executionSource } from './source';
import { dispatchBusinessCommand } from './commandDispatch';

export function executionSubtaskUseCases(deps: BusinessExecutionDeps): Pick<BusinessExecutionApi, 'submitSubtask' | 'getSubtask' | 'listSubtasks'> & { progressSubtask(): Promise<number> } {
  const source = executionSource(deps);
  const owned = async (caller: BusinessExecutionCaller, taskId: TaskId) => {
    const context = await source(caller), parent = await deps.operations.forTask(context.serviceId, taskId);
    if (!parent) throw notFound('业务任务', taskId);
    return { ...context, parent };
  };
  const progress = async (id?: string) => {
    const claimed = await deps.subtasks.claim(newResourceId(), id);
    if (!claimed) return 0;
    if (claimed.view.kind === 'agent') await dispatchBusinessAgent(deps, claimed); else await dispatchBusinessCommand(deps, claimed); return 1;
  };
  return {
    submitSubtask: async (caller, taskId, input) => {
      const context = await owned(caller, taskId), digest = requestDigest(input);
      const previous = await deps.subtasks.find(context.serviceId, taskId, input.requestKey);
      if (previous) {
        if (previous.requestDigest !== digest) throw conflict('同一 requestKey 已用于不同子任务参数', { code: 'idempotency_conflict' });
        const replay = input.fence || previous.dispatch === 'retryable-rejected' ? await deps.subtasks.adoptPending(previous, { source: context.authority, ...(input.fence ? { fence: input.fence } : {}) }) : previous;
        if (previous.dispatch === 'retryable-rejected') await progress(replay.view.id);
        return subtaskResponse((await deps.subtasks.get(context.serviceId, taskId, replay.view.id))!, false);
      }
      const authority = { source: context.authority, ...(input.fence ? { fence: input.fence } : {}) };
      const control = await deps.controls.read(context.serviceId);
      if (control.control || context.parent.intent.tasksSpec.executionControl === 'fenced') assertExecutionFence(control.control, authority, control.now);
      const env = await deps.environments.getEnvironment(taskId);
      if (env?.state === 'paused') throw conflict('任务已暂停', { code: 'task_paused' });
      if (context.parent.state !== 'succeeded' || !env || env.state !== 'running' || !env.connected) throw precondition('任务当前不能受理子任务', { code: 'task_not_running' });
      const now = deps.clock.now().toISOString(), view: BusinessSubtaskV3Dto = {
        id: newResourceId() as SubtaskId, taskId, name: input.name, kind: input.kind, attempt: 1, state: 'pending', process: 'not-started', executionId: newResourceId(), createdAt: now,
      };
      const { requestKey: _key, fence: _fence, ...payload } = input;
      const runtimeTaskId = input.kind === 'agent' ? newResourceId() as TaskId : undefined;
      BusinessExecutionInfoSchema.parse(await deps.runner.sendCommand(taskId, { id: newResourceId(), type: 'businessExecutionInfo' }));
      const agent = input.kind === 'agent' ? await prepareAgentPlan(deps, context.parent, context.serviceId, view, runtimeTaskId!, input) : undefined;
      const commandDigest = input.kind === 'command' ? new Bun.CryptoHasher('sha256').update(businessCommandDigestInput({ command: input.argv, cwd: input.cwd, env: input.env, timeoutSeconds: input.timeoutSeconds })).digest('hex') : '';
      const saved = await admitWithRuntimeImage(deps.runtimeImages, agent?.plan.runtimeImage, { type: 'agent', id: runtimeTaskId! }, async () => deps.subtasks.reserve({ serviceId: context.serviceId, taskId, requestKind: 'submit', requestParent: '', requestKey: input.requestKey, requestDigest: digest,
        ...(agent ? { runtimeTaskId, sessionKey: agent.plan.sessionKey, sessionVolumeUid: agent.plan.volumeUid } : {}),
        sealedPayload: await deps.cipher.seal(JSON.stringify(agent?.plan ?? { ...payload, requestKey: input.requestKey })),
        payloadDigest: agent?.payloadDigest ?? commandDigest,
        fenced: context.parent.intent.tasksSpec.executionControl === 'fenced', epoch: input.fence?.epoch ?? null, view: agent?.view ?? view,
      }, authority), (result) => result.subtask.runtimeTaskId, () => acceptSubtaskObservation(deps, context.parent.intent.projectId, agent?.view ?? view, agent?.plan));
      await progress(saved.subtask.view.id);
      return subtaskResponse((await deps.subtasks.get(context.serviceId, taskId, saved.subtask.view.id))!, saved.created);
    },
    getSubtask: async (caller, taskId, id) => {
      const context = await owned(caller, taskId), subtask = await deps.subtasks.get(context.serviceId, taskId, id);
      if (!subtask) throw notFound('业务子任务', id); return subtask.view;
    },
    listSubtasks: async (caller, taskId) => { const context = await owned(caller, taskId); return (await deps.subtasks.list(context.serviceId, taskId)).map((item) => item.view); },
    progressSubtask: async () => (await progress()) + (await cleanupAgentEnvironments(deps)),
  };
}
function requestDigest(input: SubmitBusinessSubtaskV3): string {
  const { requestKey: _key, fence: _fence, ...parameters } = input; return jsonHash(parameters);
}

export function subtaskResponse(subtask: ExecutionSubtask, created: boolean) {
  if (subtask.dispatch === 'retryable-rejected') throw quotaExceeded('Agent 并发额度不足，请使用同一 requestKey 重试', { code: 'quota_exceeded', subtaskId: subtask.view.id, retryAfterSeconds: 1 });
  return { subtask: subtask.view, status: subtask.view.kind === 'agent' && (subtask.dispatch === 'pending' || subtask.dispatch === 'unknown') ? 202 as const : created ? 201 as const : 200 as const };
}
