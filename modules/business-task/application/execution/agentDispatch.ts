import type { ServiceId, TaskId } from '@crewstation/contracts';
import { BusinessExecutionInfoSchema, BusinessExecutionReceiptSchema } from '@crewstation/contracts';
import { isPlatformError, newResourceId, precondition } from '@crewstation/kernel';
import type { ExecutionAgentPlan } from '../../domain/executionAgent';
import type { ExecutionSubtask } from '../../domain/executionSubtask';
import type { BusinessExecutionDeps } from './dependencies';
import { agentCommand, agentPayloadDigest } from './agentMaterial';
import { acceptReceipt, readReceipt, unknown } from './commandDispatch';
import { businessExecutionWork } from './deletion/projectWork';

/**
 * Who receives the outcome of this dispatch. `caller`: the submit or retry request is still open and answers a
 * capacity rejection itself with 429, so the subtask becomes a retryable rejection that only a same-key replay
 * re-admits (RFC-027 §3: the platform does not queue for capacity). `background`: that request was already
 * answered 2xx, so nobody would ever see a rejection; the subtask stays pending and the worker retries admission.
 */
export type AgentDispatchCaller = 'caller' | 'background';

/** Environment and RPC always reuse their durable identities, including after ambiguous admission. */
export async function dispatchBusinessAgent(deps: BusinessExecutionDeps, claimed: ExecutionSubtask, caller: AgentDispatchCaller): Promise<void> {
  let incarnation = claimed.incarnation;
  try {
    const plan = JSON.parse(await deps.cipher.open(claimed.sealedPayload)) as ExecutionAgentPlan;
    if (plan.kind !== 'agent-plan' || !claimed.runtimeTaskId) throw new Error('invalid Agent execution plan');
    const env = await ensureAgentEnvironment(deps, claimed, plan, caller);
    if (!env) return;
    if (env.native?.state === 'finished' || env.state === 'failed' || env.state === 'released') {
      if (incarnation) await unknown(deps, claimed, 'agent_environment_lost');
      else await fail(deps, claimed, 'agent_environment_unavailable');
      return;
    }
    if (!env.connected || env.state !== 'running' || claimed.view.cancelRequestedAt) {
      await deps.subtasks.settle(claimed, { dispatch: incarnation ? 'unknown' : 'pending', runtimeAdmitted: true, view: claimed.view }); return;
    }
    const receipt = await readReceipt(deps, claimed);
    if (receipt) { await acceptReceipt(deps, claimed, receipt); return; }
    const command = await agentCommand(deps, plan);
    if (agentPayloadDigest(command, plan.nonce) !== claimed.payloadDigest) {
      if (incarnation) await unknown(deps, claimed, 'secret_version_unavailable');
      else await fail(deps, claimed, 'secret_version_unavailable');
      return;
    }
    const info = BusinessExecutionInfoSchema.parse(await deps.runner.sendCommand(env.id, { id: newResourceId(), type: 'businessExecutionInfo' }));
    if (incarnation && incarnation !== info.incarnation) { await unknown(deps, claimed, 'execution_incarnation_changed'); return; }
    if (!await deps.subtasks.checkpoint(claimed, info.incarnation)) {
      await deps.subtasks.settle(claimed, { dispatch: 'pending', runtimeAdmitted: true, view: claimed.view }); return;
    }
    await acceptBusinessCall(deps, claimed, plan, env.id);
    incarnation = info.incarnation;
    const result = BusinessExecutionReceiptSchema.parse(await deps.runner.sendCommand(env.id, { id: newResourceId(), type: 'startBusinessAgent', executionId: claimed.view.executionId,
      attempt: claimed.view.attempt, incarnation, payloadDigest: claimed.payloadDigest, digestNonce: plan.nonce, agent: command }));
    await acceptReceipt(deps, { ...claimed, incarnation, runtimeAdmitted: true }, result);
  } catch (error) {
    const code = isPlatformError(error) ? String(error.details?.code ?? error.kind) : 'dispatch_unknown';
    if (!incarnation && ['unsupported_capability', 'profile_revision_missing', 'secret_version_unavailable', 'protocol_unsupported', 'interpreter_unavailable', 'material_objects_released', 'material_objects_unpinned'].includes(code)) await fail(deps, claimed, code);
    else if (incarnation) await unknown(deps, claimed, code);
    else await deps.subtasks.settle(claimed, { dispatch: 'pending', view: claimed.view });
  }
}
async function ensureAgentEnvironment(deps: BusinessExecutionDeps, claimed: ExecutionSubtask, plan: ExecutionAgentPlan, caller: AgentDispatchCaller) {
  if (plan.runtimeImage) {
    if (!deps.runtimeImages?.confirmAgent) throw precondition('未启用业务 Agent 镜像引用确认', { code: 'unsupported_capability' });
    await deps.runtimeImages.confirmAgent(plan.runtimeImage, claimed.runtimeTaskId!);
  }
  const existing = await deps.environments.getEnvironment(claimed.runtimeTaskId!);
  if (existing) return existing;
  if (!claimed.runtimeDispatched && !await deps.subtasks.checkpointRuntime(claimed)) return undefined;
  try {
    return await deps.environments.createNativeExecution({ id: claimed.runtimeTaskId!, parentTaskId: claimed.taskId, purpose: 'subtask',
      agentId: claimed.view.executionId, runnerId: claimed.runtimeTaskId!, fingerprint: claimed.payloadDigest,
      profile: plan.compute.taskProfile, image: plan.runtimeImage?.image ?? plan.compute.image, runtimeImage: plan.runtimeImage,
      computeProfile: { profileId: plan.compute.id, revision: plan.compute.revision }, businessSession: { key: plan.sessionKey, mode: plan.sessionKey === claimed.runtimeTaskId ? 'create' : 'existing' } });
  } catch (error) {
    if (isPlatformError(error) && error.kind === 'quota_exceeded') {
      // The runtime owner checks the original ID before quota. This rejection proves no resource was admitted.
      // A rejection after a 2xx answer must not wait for a replay the caller has no reason to send: before this,
      // the background claim of an accepted subtask parked it here and the caller observed `pending` until its deadline.
      await deps.subtasks.settle(claimed, { dispatch: caller === 'caller' ? 'retryable-rejected' : 'pending', runtimeDispatched: false, runtimeAdmitted: false, view: claimed.view });
      return undefined;
    }
    throw error;
  }
}
async function fail(deps: BusinessExecutionDeps, claimed: ExecutionSubtask, code: string) {
  await deps.subtasks.failBeforeStart(claimed, { runtimeAdmitted: true, error: { code, message: 'Agent 未启动，固定执行材料或环境不可用' } });
}

export async function cleanupAgentEnvironments(deps: BusinessExecutionDeps): Promise<number> {
  let count = 0;
  for (const subtask of await deps.subtasks.cleanupCandidates(20)) {
    try {
      await businessExecutionWork(deps, { serviceId: subtask.serviceId, taskId: subtask.taskId, kind: 'agent-cleanup', reference: subtask.view.id, revision: subtask.revision }, async (scoped) => {
        const env = await scoped.environments.getEnvironment(subtask.runtimeTaskId!);
        if ((!env && (!subtask.runtimeDispatched || await scoped.environments.blockBusinessAdmission?.(subtask.serviceId as ServiceId, subtask.runtimeTaskId!))) || env?.native?.state === 'finished' || env?.state === 'released') { await scoped.subtasks.markRuntimeReleased(subtask); count++; }
        else if (env) await scoped.environments.releaseEnvironment(env.id, 'business');
      });
    } catch { deps.logger.warn('business Agent environment cleanup pending', { subtaskId: subtask.view.id }); }
  }
  return count;
}

/** 派发前受理这次 Agent 子任务尝试；展示名取任务的 `name` 标签与发布里的 Agent 档案名。未装配记录端口时什么也不做。 */
export async function acceptBusinessCall(deps: BusinessExecutionDeps, claimed: ExecutionSubtask, plan: ExecutionAgentPlan, runtimeTaskId: TaskId): Promise<void> {
  if (!deps.agentCalls) return;
  const parent = await deps.operations.forTask(claimed.serviceId, claimed.taskId);
  const agentKey = claimed.view.agentProfileId ?? plan.request.agentProfileId;
  const profile = parent?.intent.tasksSpec.agentProfiles.find((entry) => entry.id === agentKey);
  await deps.agentCalls.accept({ projectId: plan.projectId, taskId: claimed.taskId, taskLabel: parent?.intent.task.labels['name'] ?? claimed.taskId,
    subtaskId: claimed.view.id, attempt: claimed.view.attempt, runtimeTaskId, agentId: claimed.view.executionId, agentKey, agentLabel: profile?.name ?? agentKey,
    profile: { id: plan.compute.id, revision: plan.compute.revision, name: plan.compute.name }, protocol: plan.compute.protocol });
}
