import type { ServiceId, TaskId } from '@crewstation/contracts';
import { BusinessExecutionInfoSchema, BusinessExecutionReceiptSchema } from '@crewstation/contracts';
import { isPlatformError, newResourceId, precondition } from '@crewstation/kernel';
import type { ExecutionAgentPlan } from '../../domain/executionAgent';
import type { ExecutionSubtask } from '../../domain/executionSubtask';
import type { BusinessExecutionDeps } from './dependencies';
import { agentCommand, agentPayloadDigest } from './agentMaterial';
import { acceptReceipt, readReceipt, unknown } from './commandDispatch';

/** Environment and RPC always reuse their durable identities, including after ambiguous admission. */
export async function dispatchBusinessAgent(deps: BusinessExecutionDeps, claimed: ExecutionSubtask): Promise<void> {
  let incarnation = claimed.incarnation;
  try {
    const plan = JSON.parse(await deps.cipher.open(claimed.sealedPayload)) as ExecutionAgentPlan;
    if (plan.kind !== 'agent-plan' || !claimed.runtimeTaskId) throw new Error('invalid Agent execution plan');
    const env = await ensureAgentEnvironment(deps, claimed, plan);
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
    const info = await observationInfo(deps, env.id);
    if (incarnation && incarnation !== info.incarnation) { await unknown(deps, claimed, 'execution_incarnation_changed'); return; }
    if (!await deps.subtasks.checkpoint(claimed, info.incarnation)) {
      await deps.subtasks.settle(claimed, { dispatch: 'pending', runtimeAdmitted: true, view: claimed.view }); return;
    }
    incarnation = info.incarnation;
    const result = BusinessExecutionReceiptSchema.parse(await deps.runner.sendCommand(env.id, { id: newResourceId(), type: 'startBusinessAgent', executionId: claimed.view.executionId,
      attempt: claimed.view.attempt, incarnation, payloadDigest: claimed.payloadDigest, digestNonce: plan.nonce, agent: command,
      ...(info.usageObservationsV1 === 1 ? { usageObservationsV1: 1 as const } : {}),
      ...(info.usageObservationsV1 === 1 && info.nativeUsageTreeV1 === 1 ? { nativeUsageTreeV1: 1 as const, nativeUsageLineageKey: plan.sessionKey } : {}) }));
    await acceptReceipt(deps, { ...claimed, incarnation, runtimeAdmitted: true }, result);
  } catch (error) {
    const code = isPlatformError(error) ? String(error.details?.code ?? error.kind) : 'dispatch_unknown';
    if (!incarnation && ['unsupported_capability', 'profile_revision_missing', 'secret_version_unavailable', 'protocol_unsupported', 'interpreter_unavailable'].includes(code)) await fail(deps, claimed, code);
    else if (incarnation) await unknown(deps, claimed, code);
    else await deps.subtasks.settle(claimed, { dispatch: 'pending', view: claimed.view });
  }
}
async function ensureAgentEnvironment(deps: BusinessExecutionDeps, claimed: ExecutionSubtask, plan: ExecutionAgentPlan) {
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
      await deps.subtasks.settle(claimed, { dispatch: 'retryable-rejected', runtimeDispatched: false, runtimeAdmitted: false, view: claimed.view });
      return undefined;
    }
    throw error;
  }
}
async function fail(deps: BusinessExecutionDeps, claimed: ExecutionSubtask, code: string) {
  await deps.subtasks.settle(claimed, { dispatch: 'failed', runtimeAdmitted: true, view: { ...claimed.view, state: 'failed', process: 'not-started', endedAt: deps.clock.now().toISOString(), error: { code, message: 'Agent 未启动，固定执行材料或环境不可用' } } });
}

export async function cleanupAgentEnvironments(deps: BusinessExecutionDeps): Promise<number> {
  let count = 0;
  for (const subtask of await deps.subtasks.cleanupCandidates(20)) {
    try {
      const env = await deps.environments.getEnvironment(subtask.runtimeTaskId!);
      if ((!env && (!subtask.runtimeDispatched || await deps.environments.blockBusinessAdmission?.(subtask.serviceId as ServiceId, subtask.runtimeTaskId!))) || env?.native?.state === 'finished' || env?.state === 'released') { await deps.subtasks.markRuntimeReleased(subtask); count++; }
      else if (env) await deps.environments.releaseEnvironment(env.id, 'business');
    } catch { deps.logger.warn('business Agent environment cleanup pending', { subtaskId: subtask.view.id }); }
  }
  return count;
}

/** Capability omission is the legacy path; transient failures must not silently change an accepted launch. */
async function observationInfo(deps: BusinessExecutionDeps, taskId: TaskId) {
  const send = (capabilities: { usageObservationsV1?: 1; nativeUsageTreeV1?: 1 }) => deps.runner.sendCommand(taskId, { id: newResourceId(), type: 'businessExecutionInfo', ...capabilities });
  try {
    return BusinessExecutionInfoSchema.parse(await send({ usageObservationsV1: 1, nativeUsageTreeV1: 1 }));
  } catch (error) {
    if (!isPlatformError(error) || error.details?.code !== 'unsupported_capability') throw error;
    if (error.details.capability === 'usageObservationsV1') return BusinessExecutionInfoSchema.parse(await send({}));
    if (error.details.capability !== 'nativeUsageTreeV1') throw error;
    try { return BusinessExecutionInfoSchema.parse(await send({ usageObservationsV1: 1 })); }
    catch (fallback) {
      if (!isPlatformError(fallback) || fallback.details?.code !== 'unsupported_capability' || fallback.details.capability !== 'usageObservationsV1') throw fallback;
      return BusinessExecutionInfoSchema.parse(await send({}));
    }
  }
}
